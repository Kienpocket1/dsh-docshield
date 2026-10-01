/**
 * A long-running helper process owned by the gate, restarted with back-off if
 * it dies: the shared bge-m3 service (docshield/scripts/embed-server.mjs)
 * and, in docker mode, the host DocShield service (docshield/scripts/docshield-server.mjs).
 */
import { spawn } from 'node:child_process'

export class EmbedService {
  /**
   * @param {object} opts
   * @param {string} opts.script
   * @param {number} opts.port
   * @param {string} [opts.name]       log prefix (default "embed")
   * @param {string[]} [opts.args]     extra arguments after --port
   * @param {NodeJS.ProcessEnv} [opts.env]
   * @param {() => Promise<void> | void} [opts.onHealthy] after every (re)start, e.g. to re-register state lost with the process
   * @param {(m: string) => void} [opts.log]
   */
  constructor(opts) {
    this.opts = { log: () => {}, name: 'embed', args: [], ...opts }
    this.url = `http://127.0.0.1:${opts.port}/embed`
    this.origin = `http://127.0.0.1:${opts.port}`
    this.child = undefined
    this.stopped = false
    this.restarts = 0
  }

  async start() {
    this.stopped = false
    this.#spawn()
    await this.waitHealthy()
    await this.opts.onHealthy?.()
  }

  #spawn() {
    const { name } = this.opts
    const child = spawn(process.execPath, [this.opts.script, '--port', String(this.opts.port), ...this.opts.args], {
      env: { ...process.env, ...this.opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const prefix = new RegExp(`^\\[${name}\\] `)
    const log = chunk => chunk.toString('utf8').split('\n').filter(Boolean).forEach(l => this.opts.log(`[${name}] ${l.replace(prefix, '')}`))
    child.stdout.on('data', log)
    child.stderr.on('data', log)
    child.once('exit', code => {
      if (this.child === child) this.child = undefined
      if (this.stopped) return
      const delay = Math.min(30_000, 1000 * 2 ** this.restarts++)
      this.opts.log(`[${name}] exited (${code}); restarting in ${delay} ms`)
      setTimeout(() => {
        if (this.stopped) return
        this.#spawn()
        this.waitHealthy().then(() => this.opts.onHealthy?.()).catch(error => this.opts.log(`[${name}] ${error.message}`))
      }, delay).unref()
    })
    this.child = child
  }

  async waitHealthy(timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`${this.origin}/health`)
        if (res.ok) { this.restarts = 0; return }
      } catch { /* not up yet */ }
      await new Promise(r => setTimeout(r, 300))
    }
    throw new Error(`${this.opts.name} service did not become healthy on port ${this.opts.port}`)
  }

  stop() {
    this.stopped = true
    this.child?.kill()
    this.child = undefined
  }
}
