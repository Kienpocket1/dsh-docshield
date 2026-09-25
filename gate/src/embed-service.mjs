/**
 * The shared bge-m3 service (dsh-docshield/scripts/embed-server.mjs), run by
 * the gate so every per-user DSH uses one model instead of loading its own.
 * Restarted with back-off if it dies.
 */
import { spawn } from 'node:child_process'

export class EmbedService {
  /**
   * @param {{ script: string, port: number, env?: NodeJS.ProcessEnv, log?: (m: string) => void }} opts
   */
  constructor(opts) {
    this.opts = { log: () => {}, ...opts }
    this.url = `http://127.0.0.1:${opts.port}/embed`
    this.child = undefined
    this.stopped = false
    this.restarts = 0
  }

  async start() {
    this.stopped = false
    this.#spawn()
    await this.waitHealthy()
  }

  #spawn() {
    const child = spawn(process.execPath, [this.opts.script, '--port', String(this.opts.port)], {
      env: { ...process.env, ...this.opts.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    const log = chunk => chunk.toString('utf8').split('\n').filter(Boolean).forEach(l => this.opts.log(`[embed] ${l.replace(/^\[embed\] /, '')}`))
    child.stdout.on('data', log)
    child.stderr.on('data', log)
    child.once('exit', code => {
      if (this.child === child) this.child = undefined
      if (this.stopped) return
      const delay = Math.min(30_000, 1000 * 2 ** this.restarts++)
      this.opts.log(`[embed] exited (${code}); restarting in ${delay} ms`)
      setTimeout(() => { if (!this.stopped) this.#spawn() }, delay).unref()
    })
    this.child = child
  }

  async waitHealthy(timeoutMs = 20_000) {
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      try {
        const res = await fetch(`http://127.0.0.1:${this.opts.port}/health`)
        if (res.ok) { this.restarts = 0; return }
      } catch { /* not up yet */ }
      await new Promise(r => setTimeout(r, 300))
    }
    throw new Error(`embedding service did not become healthy on port ${this.opts.port}`)
  }

  stop() {
    this.stopped = true
    this.child?.kill()
    this.child = undefined
  }
}
