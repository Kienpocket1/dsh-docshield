/**
 * One DeepSeek Harness process per user. Each instance gets its own DSH_HOME
 * (sessions, workspaces, settings) and a loopback port picked by the OS. The
 * gate reads the launch URL `dsh web: http://127.0.0.1:<port>/?token=…` from
 * the child's stdout and trades the token for DSH's own auth cookie, which it
 * attaches to every proxied request; the browser never sees that cookie.
 *
 * A per-user patch pins the DocShield identity (so DocShield no longer infers
 * the user from the session folder), the shared embedding service, and the
 * DocShield agent preset. Instances start on first use and stop after
 * `idleMs` without requests or open WebSockets.
 *
 * With `runtime: 'docker'` each instance is a container (image built from
 * container/Dockerfile) instead: its home is a per-user volume, the only host
 * folder it sees is its owner's storage area (no database), DocShield inside
 * it works through the host DocShield service with a per-container token, and
 * its port is published on the host's 127.0.0.1 only.
 */
import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { credentialValues, parseProviders, proxiedSettings } from './llm-proxy.mjs'

const LAUNCH_LINE = /dsh web: (http:\/\/127\.0\.0\.1:(\d+))\/\?token=([A-Za-z0-9_-]+)/
const SWEEP_MS = 60_000

export class InstanceManager {
  /**
   * @param {object} opts
   * @param {string} opts.dshBin       absolute path to @deepseek-ai/dsh/lib/bin.js
   * @param {string} opts.homesDir     parent directory of per-user DSH homes
   * @param {string} opts.templateHome existing DSH home whose settings, credentials, presets and profile packages are reused
   * @param {string[]} opts.bundles    profile bundles for every instance
   * @param {{ storageRoot: string, embedUrl?: string }} [opts.docshield] DocShield row config shared by all instances
   * @param {number} [opts.idleMs]     stop an instance after this long without traffic (0 = never)
   * @param {(msg: string) => void} [opts.log]
   * @param {number} [opts.startTimeoutMs]
   * @param {'local' | 'docker'} [opts.runtime]
   * @param {{ bin: string, image: string, templateDir: string, serviceUrl: string, llmUrl: string, hostPorts: number[], internet: boolean, memory: string, cpus: string }} [opts.docker]
   * @param {{ register(token: string, scope: object): Promise<void>, revoke(token: string): Promise<void> }} [opts.docshieldTokens] docker mode: the host DocShield service
   */
  constructor(opts) {
    this.opts = { startTimeoutMs: 90_000, idleMs: 30 * 60_000, log: () => {}, ...opts }
    /** @type {Map<string, Promise<Instance>>} */
    this.instances = new Map()
    /** @type {Map<string, { last: number, sockets: number }>} */
    this.activity = new Map()
    /** Docker mode: DocShield service token of each running container. @type {Map<string, { token: string, scope: object }>} */
    this.tokens = new Map()
    this.sweeper = this.opts.idleMs > 0 ? setInterval(() => this.#sweep(), SWEEP_MS) : undefined
    this.sweeper?.unref()
  }

  /** Start (once) and return the user's instance. Concurrent callers share one start. */
  get(account) {
    const user = account.username
    this.touch(user)
    let pending = this.instances.get(user)
    if (pending === undefined) {
      pending = this.#start(account)
      this.instances.set(user, pending)
      // A failed start must not leave its DocShield token valid.
      pending.catch(() => { this.instances.delete(user); this.#dropToken(user) })
    }
    return pending
  }

  touch(user) {
    const a = this.activity.get(user) ?? { last: 0, sockets: 0 }
    a.last = Date.now()
    this.activity.set(user, a)
  }

  /** Track a proxied WebSocket so a live UI keeps its instance running. */
  socketOpened(user, socket) {
    this.touch(user)
    this.activity.get(user).sockets++
    socket.once('close', () => {
      const a = this.activity.get(user)
      if (a !== undefined) { a.sockets = Math.max(0, a.sockets - 1); a.last = Date.now() }
    })
  }

  async stop(user) {
    const pending = this.instances.get(user)
    this.instances.delete(user)
    const instance = await pending?.catch(() => undefined)
    if (instance !== undefined) this.#kill(user, instance.child)
  }

  /** Remove containers a previous gate left running (killed without its shutdown handler). */
  removeOrphans() {
    if (this.opts.runtime !== 'docker') return []
    const bin = this.opts.docker.bin
    const names = execFileSync(bin, ['ps', '-a', '--filter', 'name=^gate-dsh-', '--format', '{{.Names}}'], { encoding: 'utf8', windowsHide: true })
      .split(/\r?\n/).filter(Boolean)
    if (names.length) execFileSync(bin, ['rm', '-f', ...names], { stdio: 'ignore', windowsHide: true })
    return names
  }

  /** Killing the docker CLI on Windows leaves the container running, so remove it by name. */
  #kill(user, child) {
    if (this.opts.runtime === 'docker') {
      try { execFileSync(this.opts.docker.bin, ['rm', '-f', containerName(user)], { stdio: 'ignore', windowsHide: true }) } catch {}
      this.#dropToken(user)
    }
    child.kill()
  }

  #dropToken(user) {
    const issued = this.tokens.get(user)
    this.tokens.delete(user)
    if (issued !== undefined) void this.opts.docshieldTokens.revoke(issued.token).catch(() => {})
  }

  /** Stop every child; used on gate shutdown. */
  async stopAll() {
    if (this.sweeper) clearInterval(this.sweeper)
    await Promise.all([...this.instances.keys()].map(u => this.stop(u)))
  }

  #sweep(now = Date.now()) {
    for (const user of this.instances.keys()) {
      const a = this.activity.get(user)
      if (a === undefined || (a.sockets === 0 && now - a.last > this.opts.idleMs)) {
        this.opts.log(`[${user}] idle for ${Math.round(this.opts.idleMs / 60_000)} min, stopping`)
        void this.stop(user)
      }
    }
  }

  /** Home layout: settings, credentials, presets copied; profile node_modules linked to the template's. */
  ensureHome(account) {
    const home = path.join(this.opts.homesDir, account.username)
    const profile = path.join(home, 'profiles', 'web')
    if (!existsSync(path.join(profile, 'package.json'))) {
      const tpl = this.opts.templateHome
      mkdirSync(profile, { recursive: true })
      cpSync(path.join(tpl, 'settings.yaml'), path.join(home, 'settings.yaml'))
      // Model provider keys (e.g. the local router) live here, not in settings.yaml.
      const credentials = path.join(tpl, '.credentials.yaml')
      if (existsSync(credentials)) cpSync(credentials, path.join(home, '.credentials.yaml'))
      cpSync(path.join(tpl, '.agent-presets'), path.join(home, '.agent-presets'), { recursive: true })
      writeFileSync(path.join(profile, 'package.json'), JSON.stringify({
        name: 'dsh-profile-web', private: true, dsh: { profile: { bundles: this.opts.bundles } },
      }, null, 2))
      writeFileSync(path.join(profile, 'cordis.yml'), '[]\n')
      writeFileSync(path.join(profile, 'cordis.patch.yml'), '[]\n')
      symlinkSync(path.join(tpl, 'profiles', 'web', 'node_modules'), path.join(profile, 'node_modules'), 'junction')
    }
    // The DocShield preset is the only agent mode; hide the picker (role may change, so rewrite each start).
    const settings = path.join(home, 'settings.yaml')
    const preset = presetFor(account)
    const text = readFileSync(settings, 'utf8').replace(/\n?# dsh-gate:agent-presets[\s\S]*$/, '')
    writeFileSync(settings, text)
    appendFileSync(settings, `\n# dsh-gate:agent-presets (managed; do not edit below)\nagent-presets:\n  modeSelectionEnabled: false\n  default: ${preset}\n`)
    return home
  }

  /** Per-user cordis patch: DocShield identity + shared embedder, DocShield as default preset. */
  writePatch(account, home) {
    const file = path.join(home, 'gate.patch.yml')
    const ds = this.opts.docshield
    let yaml = `# Written by dsh-gate on every start; edits are overwritten.\n- id: agent-presets\n  config:\n    default: ${presetFor(account)}\n`
    if (ds !== undefined) {
      yaml += `- id: docshield-core\n  config:\n    storageRoot: ${JSON.stringify(ds.storageRoot)}\n`
      if (ds.embedUrl) yaml += `    embedUrl: ${JSON.stringify(ds.embedUrl)}\n`
      yaml += account.role === 'admin' ? '    identity:\n      role: admin\n' : `    identity:\n      user: ${JSON.stringify(account.username)}\n`
    }
    writeFileSync(file, yaml)
    return file
  }

  /**
   * Model routes of the template home that the gate's model proxy serves:
   * providers with a baseURL and an apiKeyEnv whose key is set (gate
   * environment first, like DSH, then the template credentials).
   * @returns {{ name: string, baseURL: string, apiKeyEnv: string, key: string }[]}
   */
  llmProviders() {
    const settings = readFileSync(path.join(this.opts.templateHome, 'settings.yaml'), 'utf8')
    const credentials = path.join(this.opts.templateHome, '.credentials.yaml')
    const stored = existsSync(credentials) ? credentialValues(readFileSync(credentials, 'utf8')) : new Map()
    return parseProviders(settings)
      .filter(p => p.baseURL && p.apiKeyEnv)
      .map(p => ({ ...p, key: process.env[p.apiKeyEnv] || stored.get(p.apiKeyEnv) || '' }))
      .filter(p => p.key !== '')
  }

  /**
   * Container template: settings whose model routes go through the gate's
   * proxy, and credentials with no secrets at all: no API key (the proxy holds
   * it) and no browser-session secret (each container makes its own).
   */
  writeDockerTemplate() {
    const dir = this.opts.docker.templateDir
    mkdirSync(dir, { recursive: true })
    const settings = readFileSync(path.join(this.opts.templateHome, 'settings.yaml'), 'utf8')
    writeFileSync(path.join(dir, 'settings.yaml'), proxiedSettings(settings, this.opts.docker.llmUrl, this.llmProviders().map(p => p.name)))
    writeFileSync(path.join(dir, '.credentials.yaml'), 'version: 1\nrecords: {}\nrefs: {}\n')
    return dir
  }

  /** Account name of the running container that holds `token`, for the model proxy. */
  tokenOwner(token) {
    for (const [user, issued] of this.tokens) if (issued.token === token) return user
    return undefined
  }

  /**
   * `docker run` in the foreground: the CLI's stdout carries the container's,
   * like a local child. The container gets only its owner's storage folder;
   * DocShield inside it reaches the host service with a fresh token that the
   * service maps to this account and that is revoked when the container stops.
   */
  async #spawnDocker(account) {
    const d = this.opts.docker
    const user = account.username
    const name = containerName(user)
    // A container left behind by a crashed gate would hold the name.
    execFileSync(d.bin, ['rm', '-f', name], { stdio: 'ignore', windowsHide: true })
    const scope = account.role === 'admin' ? { role: 'admin' } : { role: 'user', userId: user }
    const token = randomBytes(32).toString('base64url')
    await this.opts.docshieldTokens.register(token, scope)
    this.tokens.set(user, { token, scope })
    const area = account.role === 'admin' ? 'admin' : `users/${user}`
    const folder = path.resolve(this.opts.docshield.storageRoot, area)
    mkdirSync(path.join(folder, 'docs'), { recursive: true })
    const args = [
      'run', '--rm', '--name', name,
      '-p', '127.0.0.1::3090',
      '--memory', d.memory, '--cpus', d.cpus, '--pids-limit', '512',
      // Network lockdown (container/firewall.mjs): root only long enough to set iptables, then user node
      // with every capability dropped; no_new_privs; no IPv6; host reachable only on d.hostPorts.
      '--cap-drop', 'ALL', ...['NET_ADMIN', 'NET_RAW', 'SETUID', 'SETGID', 'SETPCAP'].flatMap(c => ['--cap-add', c]),
      '--security-opt', 'no-new-privileges', '--sysctl', 'net.ipv6.conf.all.disable_ipv6=1',
      '--add-host', 'host.docker.internal:host-gateway',
      '-e', `GATE_ALLOW_HOST_PORTS=${d.hostPorts.join(',')}`, ...(d.internet ? ['-e', 'GATE_INTERNET=1'] : []),
      '-e', `GATE_USER=${user}`, '-e', `GATE_ROLE=${account.role}`,
      '-e', `DOCSHIELD_SERVICE_URL=${d.serviceUrl}`, '-e', `DOCSHIELD_TOKEN=${token}`,
      // DSH reads a provider key from the environment first: give it the token, the proxy swaps in the real key.
      ...this.llmProviders().flatMap(p => ['-e', `${p.apiKeyEnv}=${token}`]),
      '-v', `dsh-home-${user}:/home/dsh`,
      '-v', `${folder}:/storage/${area}`,
      '-v', `${this.writeDockerTemplate()}:/template:ro`,
      d.image,
    ]
    return spawn(d.bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
  }

  /** The host DocShield service restarted and lost its tokens: register the live ones again. */
  async reRegisterTokens() {
    for (const { token, scope } of this.tokens.values()) await this.opts.docshieldTokens.register(token, scope)
  }

  #spawnLocal(account) {
    const home = this.ensureHome(account)
    const patch = this.writePatch(account, home)
    const args = [this.opts.dshBin, '--patch', patch, '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open']
    return spawn(process.execPath, args, {
      env: { ...process.env, DSH_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
  }

  async #start(account) {
    const user = account.username
    const docker = this.opts.runtime === 'docker'
    const home = docker ? `docker:${containerName(user)}` : path.join(this.opts.homesDir, user)
    const child = docker ? await this.#spawnDocker(account) : this.#spawnLocal(account)
    const log = line => this.opts.log(`[${user}] ${line}`)
    const launch = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.#kill(user, child); reject(new Error(`instance ${user}: no launch URL within ${this.opts.startTimeoutMs} ms`)) }, this.opts.startTimeoutMs)
      let buffer = ''
      child.stdout.on('data', chunk => {
        buffer += chunk.toString('utf8')
        let nl
        while ((nl = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, nl).trimEnd()
          buffer = buffer.slice(nl + 1)
          const match = LAUNCH_LINE.exec(line)
          if (match) {
            clearTimeout(timer)
            resolve({ origin: match[1], port: Number(match[2]), token: match[3] })
            log(`listening on ${match[1]}`)
          } else if (line !== '') {
            log(line)
          }
        }
      })
      child.stderr.on('data', chunk => chunk.toString('utf8').split('\n').filter(Boolean).forEach(log))
      child.once('exit', code => { clearTimeout(timer); reject(new Error(`instance ${user} exited (${code}) before listening`)) })
    })
    if (docker) {
      // The URL names the port inside the container; the gate talks to its published host port.
      const published = execFileSync(this.opts.docker.bin, ['port', containerName(user), '3090'], { encoding: 'utf8', windowsHide: true })
      launch.port = Number(/127\.0\.0\.1:(\d+)/.exec(published)?.[1])
      if (!launch.port) { this.#kill(user, child); throw new Error(`instance ${user}: no published port (${published.trim()})`) }
      launch.origin = `http://127.0.0.1:${launch.port}`
      log(`published on ${launch.origin}`)
    }
    const cookie = await exchangeToken(launch.origin, launch.token)
    const instance = { user, home, child, port: launch.port, origin: launch.origin, cookie }
    child.once('exit', code => {
      log(`exited (${code})`)
      if (this.instances.get(user) !== undefined) {
        void this.instances.get(user).then(i => { if (i === instance) this.instances.delete(user) }, () => {})
      }
    })
    return instance
  }
}

const presetFor = account => account.role === 'admin' ? 'docshield-admin' : 'docshield'
const containerName = user => `gate-dsh-${user}`

/** GET /?token=… → 303 with Set-Cookie dsh-auth-*; returns "name=value" for later requests. */
export function exchangeToken(origin, token) {
  return new Promise((resolve, reject) => {
    const req = http.get(`${origin}/?token=${encodeURIComponent(token)}`, res => {
      res.resume()
      const cookies = res.headers['set-cookie'] ?? []
      const auth = cookies.map(c => c.split(';')[0]).find(c => c.startsWith('dsh-auth-'))
      if (auth === undefined) reject(new Error(`token exchange failed: HTTP ${res.statusCode}, no dsh-auth cookie`))
      else resolve(auth)
    })
    req.on('error', reject)
  })
}

/**
 * @typedef {object} Instance
 * @property {string} user
 * @property {string} home
 * @property {import('node:child_process').ChildProcess} child
 * @property {number} port
 * @property {string} origin
 * @property {string} cookie
 */
