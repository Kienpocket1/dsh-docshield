import { parseDocument } from '../dist/ingest/parse.js'
import { chunkDocument } from '../dist/ingest/chunk.js'
import { WorkerEmbedder } from '../dist/embed/embedder.js'
const chunks = chunkDocument(await parseDocument('E:/Deepseek_Harness/spike-dshpw/storage/public_docs/DeepSeek-Harness-Handbook.pdf'))
const e = new WorkerEmbedder({ modelsDir: 'E:/Deepseek_Harness/spike-dshpw/storage/.docshield/models', batchSize: 16 })
const t = performance.now()
for (let i = 0; i < chunks.length; i += 16) {
  const b = performance.now()
  const batch = chunks.slice(i, i + 16).map(c => c.text)
  const v = await e.embed(batch)
  console.log('batch', i / 16, 'n', v.length, 'maxChars', Math.max(...batch.map(s => s.length)), 'ms', Math.round(performance.now() - b), 'rssMB', Math.round(process.memoryUsage().rss / 1048576))
}
console.log('total s', Math.round((performance.now() - t) / 1000))
await e.dispose()
