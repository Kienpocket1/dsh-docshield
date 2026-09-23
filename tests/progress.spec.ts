import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HashEmbedder, type EmbedProgress, type Embedder } from '../src/embed/embedder.js'
import { ingestUploads } from '../src/ingest/attachments.js'
import { targetForPath } from '../src/ingest/layout.js'
import { DocShieldService } from '../src/service.js'

/** Embeds in batches of 2 and pauses after the first batch until released. */
class GatedEmbedder implements Embedder {
  private readonly inner = new HashEmbedder()
  private release: () => void = () => {}
  private onPause: () => void = () => {}
  readonly paused: Promise<void>
  private readonly gate: Promise<void>

  constructor() {
    // Assigned here, not in field initialisers, so later field definitions cannot reset them.
    this.paused = new Promise<void>(resolve => { this.onPause = resolve })
    this.gate = new Promise<void>(resolve => { this.release = resolve })
  }

  async embed(texts: readonly string[], onProgress?: EmbedProgress): Promise<Float32Array[]> {
    const out: Float32Array[] = []
    for (let i = 0; i < texts.length; i += 2) {
      out.push(...await this.inner.embed(texts.slice(i, i + 2)))
      onProgress?.(out.length, texts.length)
      if (i === 0 && texts.length > 2) {
        this.onPause()
        await this.gate
      }
    }
    return out
  }

  open(): void {
    this.release()
  }

  async dispose(): Promise<void> {}
}

let root: string
let embedder: GatedEmbedder
let service: DocShieldService
const alice = { role: 'user', userId: 'alice' } as const
const LONG = Array.from({ length: 6 }, (_, i) => `# Mục ${i + 1}\n${'Nội dung dài của mục này. '.repeat(90)}`).join('\n\n')

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'docshield-prog-'))
  for (const dir of ['users/alice/docs', 'public_docs']) mkdirSync(path.join(root, dir), { recursive: true })
  embedder = new GatedEmbedder()
  service = new DocShieldService(root, { embedder, log: () => {}, dbFile: ':memory:' })
})

afterEach(async () => {
  embedder.open()
  await service.dispose()
  rmSync(root, { recursive: true, force: true })
})

describe('indexing progress', () => {
  it('lists a document as "đang nạp" with progress, then "đã nạp"', async () => {
    const file = path.join(root, 'users/alice/docs/so_tay.md')
    writeFileSync(file, LONG)
    const done = service.indexer.ingest(targetForPath(root, file)!)
    await embedder.paused

    const busy = service.listDocuments(alice)
    expect(busy).toHaveLength(1)
    expect(busy[0]).toMatchObject({ filename: 'so_tay.md', status: 'đang nạp', scope: 'cá nhân' })
    expect(busy[0]!.progress).toMatch(/^2\/\d+ đoạn$/)
    expect(busy[0]!.chunks).toBeGreaterThan(2)

    embedder.open()
    await done
    const after = service.listDocuments(alice)
    expect(after).toMatchObject([{ filename: 'so_tay.md', status: 'đã nạp' }])
    expect(after[0]!.progress).toBeUndefined()
    expect(service.indexer.inProgress()).toEqual([])
  })

  it('does not show another user\'s document while it is being indexed', async () => {
    const file = path.join(root, 'users/alice/docs/rieng.md')
    writeFileSync(file, LONG)
    const done = service.indexer.ingest(targetForPath(root, file)!)
    await embedder.paused
    expect(service.listDocuments({ role: 'user', userId: 'bob' })).toEqual([])
    embedder.open()
    await done
  })

  it('announces an upload before its indexing finishes', async () => {
    const source = path.join(root, 'blob')
    writeFileSync(source, LONG)
    const events: string[] = []
    const uploads = ingestUploads({ id: 's', header: { cwd: path.join(root, 'users/alice') } }, [{ attachmentId: 'a', name: 'so_tay.md', bytes: 100 }], {
      storageRoot: root,
      attachments: { fileHostPath: () => source },
      indexer: service.indexer,
      resolve: service.resolve,
      onAccepted: name => events.push(`accepted ${name}`),
    })
    await embedder.paused
    expect(events).toEqual(['accepted so_tay.md'])
    embedder.open()
    expect(await uploads).toMatchObject([{ result: { status: 'indexed' } }])
  })
})
