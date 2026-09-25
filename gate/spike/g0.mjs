// G0 spike: prove one gate can front a separate DSH per user (HTTP + WebSocket).
// No passwords here — /gate/as/<user> just picks the user. Do not expose.
//   node spike/g0.mjs      then open http://127.0.0.1:3500/gate/as/alice
import http from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { InstanceManager } from '../src/instance.mjs'
import { proxyHttp, proxyUpgrade } from '../src/proxy.mjs'

const here = path.dirname(fileURLToPath(import.meta.url))
const PORT = 3500
const USERS = new Set(['alice', 'bob'])

const manager = new InstanceManager({
  dshBin: 'E:/Deepseek_Harness/spike-dshpw/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js',
  homesDir: path.resolve(here, '../var/homes'),
  templateHome: 'E:/Deepseek_Harness/spike-dshpw/dsh-home',
  bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-docshield'],
  log: msg => console.log(msg),
})

const userOf = req => /(?:^|;\s*)gate_spike_user=([a-z]+)/.exec(req.headers.cookie ?? '')?.[1]

const server = http.createServer(async (req, res) => {
  const pick = /^\/gate\/as\/([a-z]+)$/.exec(req.url ?? '')
  if (pick && USERS.has(pick[1])) {
    res.writeHead(303, { 'set-cookie': `gate_spike_user=${pick[1]}; Path=/; HttpOnly; SameSite=Lax`, location: '/' })
    return res.end()
  }
  const user = userOf(req)
  if (user === undefined || !USERS.has(user)) {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    return res.end('<p>G0 spike: <a href="/gate/as/alice">alice</a> · <a href="/gate/as/bob">bob</a></p>')
  }
  try {
    proxyHttp(req, res, await manager.get(user))
  } catch (err) {
    res.writeHead(503, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(String(err))
  }
})

server.on('upgrade', async (req, socket, head) => {
  const user = userOf(req)
  if (user === undefined || !USERS.has(user)) return socket.destroy()
  try {
    proxyUpgrade(req, socket, head, await manager.get(user))
  } catch {
    socket.destroy()
  }
})

server.listen(PORT, '127.0.0.1', () => console.log(`G0 gate on http://127.0.0.1:${PORT}`))
const shutdown = async () => { await manager.stopAll(); process.exit(0) }
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
