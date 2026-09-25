// Shared bge-m3 embedding service for per-user DSH instances (dsh-gate).
// One model in memory for everyone instead of one per DSH process.
//   node scripts/embed-server.mjs [--port 3490] [--models <dir>]
// POST /embed {texts: string[]} → {vectors: number[][]}; GET /health → {ok}.
// Loopback only; it computes embeddings and touches no documents.
import http from 'node:http'
import path from 'node:path'
import { WorkerEmbedder } from '../dist/embed/embedder.js'
import { storageRoot } from './lib.mjs'

const arg = (name, fallback) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : fallback }
const port = Number(arg('--port', process.env.DOCSHIELD_EMBED_PORT ?? 3490))
const modelsDir = arg('--models', path.join(storageRoot(), '.docshield', 'models'))
const MAX_BODY = 4 * 1024 * 1024
const MAX_TEXTS = 64

const embedder = new WorkerEmbedder({ modelsDir })
let served = 0

const server = http.createServer((req, res) => {
  const reply = (status, body) => {
    res.writeHead(status, { 'content-type': 'application/json' })
    res.end(JSON.stringify(body))
  }
  if (req.method === 'GET' && req.url === '/health') return reply(200, { ok: true, served })
  if (req.method !== 'POST' || req.url !== '/embed') return reply(404, { error: 'not found' })
  const chunks = []
  let size = 0
  req.on('data', c => {
    size += c.length
    if (size > MAX_BODY) { reply(413, { error: 'body too large' }); req.destroy() } else chunks.push(c)
  })
  req.on('end', async () => {
    if (res.writableEnded) return
    let texts
    try {
      texts = JSON.parse(Buffer.concat(chunks).toString('utf8')).texts
    } catch {
      return reply(400, { error: 'invalid JSON' })
    }
    if (!Array.isArray(texts) || texts.length === 0 || texts.length > MAX_TEXTS || !texts.every(t => typeof t === 'string')) {
      return reply(400, { error: `texts must be 1..${MAX_TEXTS} strings` })
    }
    try {
      const vectors = await embedder.embed(texts)
      served += texts.length
      reply(200, { vectors: vectors.map(v => Array.from(v)) })
    } catch (error) {
      reply(500, { error: error instanceof Error ? error.message : String(error) })
    }
  })
})

server.listen(port, '127.0.0.1', () => console.log(`[embed] bge-m3 service on http://127.0.0.1:${port}/embed (models: ${modelsDir})`))
const stop = async () => { server.close(); await embedder.dispose(); process.exit(0) }
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
