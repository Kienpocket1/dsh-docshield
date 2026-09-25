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
 */
import { spawn } from 'node:child_process'
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import http from 'node:http'
import path from 'node:path'

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
   */
  constructor(opts) {
    this.opts = { startTimeoutMs: 90_000, idleMs: 30 * 60_000, log: () => {}, ...opts }
    /** @type {Map<string, Promise<Instance>>} */
    this.instances = new Map()
    /** @type {Map<string, { last: number, sockets: number }>} */
    this.activity = new Map()
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
      pending.catch(() => this.instances.delete(user))
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
    instance?.child.kill()
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

  async #start(account) {
    const user = account.username
    const home = this.ensureHome(account)
    const patch = this.writePatch(account, home)
    const args = [this.opts.dshBin, '--patch', patch, '--profile', 'web', '--host', '127.0.0.1', '--port', '0', '--no-open']
    const child = spawn(process.execPath, args, {
      env: { ...process.env, DSH_HOME: home },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const log = line => this.opts.log(`[${user}] ${line}`)
    const launch = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { child.kill(); reject(new Error(`instance ${user}: no launch URL within ${this.opts.startTimeoutMs} ms`)) }, this.opts.startTimeoutMs)
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
