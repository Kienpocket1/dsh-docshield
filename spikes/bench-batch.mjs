// Embedding throughput vs batch size on real handbook chunks (model warmed first).
import { parseDocument } from '../dist/ingest/parse.js'
import { chunkDocument } from '../dist/ingest/chunk.js'
import { WorkerEmbedder } from '../dist/embed/embedder.js'
const texts = chunkDocument(await parseDocument('E:/Deepseek_Harness/spike-dshpw/storage/public_docs/DeepSeek-Harness-Handbook.pdf')).slice(16, 32).map(c => c.text)
const modelsDir = 'E:/Deepseek_Harness/spike-dshpw/storage/.docshield/models'
for (const size of [1, 4, 8, 16]) {
  const e = new WorkerEmbedder({ modelsDir, batchSize: size })
  await e.embed(['khởi động'])
  const t = performance.now()
  await e.embed(texts)
  const ms = performance.now() - t
  console.log(`batch ${String(size).padStart(2)}: ${Math.round(ms / texts.length)} ms/đoạn (16 đoạn: ${(ms / 1000).toFixed(1)}s)`)
  await e.dispose()
}
