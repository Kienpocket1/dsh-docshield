// Host DocShield service for per-user DSH containers (dsh-gate, GATE_RUNTIME=docker).
// Owns the database, watches the whole storage tree and serves tool calls/uploads.
//   DOCSHIELD_ADMIN_KEY=<key shared with the gate> node scripts/docshield-server.mjs [--port 3492] [--embed-url http://127.0.0.1:3490/embed]
// Listens on 127.0.0.1 only; containers reach it as host.docker.internal.
import { DocShieldService } from '../dist/service.js'
import { createDocShieldServer } from '../dist/server/server.js'
import { storageRoot } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback }
const port = Number(arg('--port', process.env.DOCSHIELD_SERVER_PORT ?? 3492))
const embedUrl = arg('--embed-url', process.env.DOCSHIELD_EMBED_URL)
const adminKey = process.env.DOCSHIELD_ADMIN_KEY ?? ''
if (adminKey.length < 32) {
  console.error('[docshield-server] DOCSHIELD_ADMIN_KEY (>= 32 chars) is required')
  process.exit(2)
}

const root = storageRoot()
const service = new DocShieldService(root, embedUrl ? { embedUrl } : {})
const server = createDocShieldServer(service, { adminKey })
server.listen(port, '127.0.0.1', () => console.log(`[docshield-server] http://127.0.0.1:${port} (storage: ${root})`))
void service.watcher.reconcile()
  .then(() => service.watcher.start())
  .catch(error => service.log(`startup reconcile failed: ${error instanceof Error ? error.message : String(error)}`))

const stop = async () => { server.close(); await service.dispose(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
