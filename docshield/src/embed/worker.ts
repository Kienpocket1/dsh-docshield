/** Worker thread: loads bge-m3 once (offline) and answers {id, texts} with CLS-pooled, normalised vectors. */
import { parentPort, workerData } from 'node:worker_threads'

interface Init {
  readonly modelsDir: string
  readonly model: string
}

const init = workerData as Init
type Extractor = (texts: string[], options: { pooling: 'cls'; normalize: true }) => Promise<{ dims: number[]; data: Float32Array }>
let extractor: Promise<Extractor> | undefined

async function load(): Promise<Extractor> {
  const { env, pipeline } = await import('@huggingface/transformers')
  env.localModelPath = init.modelsDir.endsWith('/') || init.modelsDir.endsWith('\\') ? init.modelsDir : `${init.modelsDir}/`
  env.allowRemoteModels = false
  env.allowLocalModels = true
  return (await pipeline('feature-extraction', init.model, { dtype: 'q8' })) as unknown as Extractor
}

parentPort?.on('message', async (msg: { id: number; texts: string[] }) => {
  try {
    extractor ??= load()
    const run = await extractor
    const output = await run(msg.texts, { pooling: 'cls', normalize: true })
    const dims = output.dims[1] ?? 0
    const vectors = msg.texts.map((_t, i) => output.data.slice(i * dims, (i + 1) * dims))
    parentPort?.postMessage({ id: msg.id, vectors }, vectors.map(v => v.buffer as ArrayBuffer))
  } catch (error) {
    extractor = undefined
    parentPort?.postMessage({ id: msg.id, error: error instanceof Error ? error.message : String(error) })
  }
})
