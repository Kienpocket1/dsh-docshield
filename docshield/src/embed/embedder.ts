/**
 * Text → 1024-d normalised vectors. The production embedder runs bge-m3
 * (ONNX int8, offline) in a worker thread so model inference never blocks
 * the DSH event loop; the worker starts on first use.
 */
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { Worker } from 'node:worker_threads'
import { EMBEDDING_DIMS } from '../db/database.js'

/** Called after each finished batch with the number of texts embedded so far. */
export type EmbedProgress = (done: number, total: number) => void

export interface Embedder {
  embed(texts: readonly string[], onProgress?: EmbedProgress): Promise<Float32Array[]>
  dispose(): Promise<void>
}

export interface WorkerEmbedderOptions {
  /** Directory holding `Xenova/bge-m3/{config.json,tokenizer.json,onnx/model_quantized.onnx}`. */
  readonly modelsDir: string
  readonly model?: string
  readonly batchSize?: number
}

interface Pending {
  resolve: (vectors: Float32Array[]) => void
  reject: (error: Error) => void
}

export class WorkerEmbedder implements Embedder {
  private worker: Worker | undefined
  private nextId = 1
  private readonly pending = new Map<number, Pending>()
  private readonly batchSize: number

  constructor(private readonly options: WorkerEmbedderOptions) {
    this.batchSize = options.batchSize ?? 16
  }

  async embed(texts: readonly string[], onProgress?: EmbedProgress): Promise<Float32Array[]> {
    const out: Float32Array[] = []
    for (let i = 0; i < texts.length; i += this.batchSize) {
      out.push(...await this.request(texts.slice(i, i + this.batchSize)))
      onProgress?.(out.length, texts.length)
    }
    return out
  }

  async dispose(): Promise<void> {
    const worker = this.worker
    this.worker = undefined
    this.failAll(new Error('embedder disposed'))
    if (worker !== undefined) await worker.terminate()
  }

  private request(texts: readonly string[]): Promise<Float32Array[]> {
    const worker = this.ensureWorker()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      // Keep the process alive only while a request is outstanding.
      worker.ref()
      worker.postMessage({ id, texts })
    })
  }

  private ensureWorker(): Worker {
    if (this.worker !== undefined) return this.worker
    const here = path.dirname(fileURLToPath(import.meta.url))
    const worker = new Worker(path.join(here, 'worker.js'), {
      workerData: { modelsDir: this.options.modelsDir, model: this.options.model ?? 'Xenova/bge-m3' },
    })
    worker.on('message', (msg: { id: number; vectors?: Float32Array[]; error?: string }) => {
      const entry = this.pending.get(msg.id)
      if (entry === undefined) return
      this.pending.delete(msg.id)
      if (this.pending.size === 0) worker.unref()
      if (msg.error !== undefined || msg.vectors === undefined) entry.reject(new Error(msg.error ?? 'embedder returned no vectors'))
      else entry.resolve(msg.vectors)
    })
    worker.on('error', (error) => {
      this.worker = undefined
      this.failAll(error)
    })
    worker.on('exit', () => {
      if (this.worker === worker) this.worker = undefined
      this.failAll(new Error('embedder worker exited'))
    })
    worker.unref()
    this.worker = worker
    return worker
  }

  private failAll(error: Error): void {
    for (const entry of this.pending.values()) entry.reject(error)
    this.pending.clear()
  }
}

/**
 * Client of the shared embedding service (`scripts/embed-server.mjs`): one
 * bge-m3 for every per-user DSH instance instead of one model per process.
 * POST {texts} → {vectors: number[][]}, batched like the worker.
 */
export class RemoteEmbedder implements Embedder {
  private readonly batchSize: number

  constructor(private readonly url: string, options: { batchSize?: number } = {}) {
    this.batchSize = options.batchSize ?? 16
  }

  async embed(texts: readonly string[], onProgress?: EmbedProgress): Promise<Float32Array[]> {
    const out: Float32Array[] = []
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize)
      const res = await fetch(this.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ texts: batch }),
      }).catch((error: unknown) => {
        throw new Error(`dịch vụ embedding không phản hồi (${this.url}): ${error instanceof Error ? error.message : String(error)}`)
      })
      if (!res.ok) throw new Error(`dịch vụ embedding lỗi HTTP ${res.status}: ${await res.text()}`)
      const body = await res.json() as { vectors?: number[][] }
      if (!Array.isArray(body.vectors) || body.vectors.length !== batch.length) throw new Error('dịch vụ embedding trả kết quả sai số lượng')
      for (const v of body.vectors) {
        if (v.length !== EMBEDDING_DIMS) throw new Error(`vector sai số chiều: ${v.length}`)
        out.push(Float32Array.from(v))
      }
      onProgress?.(out.length, texts.length)
    }
    return out
  }

  async dispose(): Promise<void> {}
}

/**
 * Deterministic bag-of-words embedder for tests: same text → same unit
 * vector, shared words → positive similarity. Never used in production.
 */
export class HashEmbedder implements Embedder {
  async embed(texts: readonly string[], onProgress?: EmbedProgress): Promise<Float32Array[]> {
    const vectors = texts.map((text) => {
      const v = new Float32Array(EMBEDDING_DIMS)
      for (const word of text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').split(/[^a-z0-9]+/)) {
        if (word === '') continue
        let h = 2166136261
        for (let i = 0; i < word.length; i++) h = Math.imul(h ^ word.charCodeAt(i), 16777619)
        v[(h >>> 0) % EMBEDDING_DIMS]! += 1
      }
      const norm = Math.hypot(...v) || 1
      for (let i = 0; i < v.length; i++) v[i]! /= norm
      return v
    })
    onProgress?.(vectors.length, texts.length)
    return vectors
  }

  async dispose(): Promise<void> {}
}
