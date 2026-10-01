import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HashEmbedder } from '../src/embed/embedder.js'
import { ingestUploads } from '../src/ingest/attachments.js'
import type { DocScope } from '../src/scope.js'
import { DocShieldService, PublishError } from '../src/service.js'

let root: string
let service: DocShieldService
const student: DocScope = { role: 'user', userId: 'alice' }
const V1 = 'Điều 5. Học bổng\nSinh viên có điểm trung bình từ 3.2 trở lên được xét học bổng khuyến khích.'
const V2 = 'Điều 5. Học bổng\nSinh viên có điểm trung bình từ 3.6 trở lên được xét học bổng khuyến khích.'

function putPublic(name: string, content: string): string {
  const file = path.join(root, 'public_docs', name)
  writeFileSync(file, content)
  return file
}

const live = () => service.store.listLive(['public']).map(d => `${d.filename}:${d.doc_key}`).sort()
const searchFiles = async (q = 'điểm trung bình học bổng') => (await service.search('s', student, q)).hits.map(h => h.filename)

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'docshield-p-'))
  for (const dir of ['users/alice/docs', 'public_docs', 'admin']) mkdirSync(path.join(root, dir), { recursive: true })
  service = new DocShieldService(root, { embedder: new HashEmbedder(), log: () => {}, dbFile: ':memory:', minSimilarity: 0.2 })
  putPublic('quy_che_v1.md', V1)
  await service.watcher.reconcile()
})

afterEach(async () => {
  await service.dispose()
  rmSync(root, { recursive: true, force: true })
})

describe('TC-05: replacing a public document', () => {
  it('without publish, v1 and v2 would both be searchable (the problem M5 solves)', async () => {
    putPublic('quy_che_v2.md', V2)
    await service.watcher.reconcile()
    expect(live()).toEqual(['quy_che_v1.md:quy_che_v1', 'quy_che_v2.md:quy_che_v2'])
  })

  it('publish v2 replacing v1: only v2 is searched and cited', async () => {
    const old = (await service.search('s', student, 'điểm trung bình học bổng')).hits[0]!
    putPublic('quy_che_v2.md', V2)
    await service.watcher.reconcile()

    const published = await service.publishPublic('quy_che_v2.md', 'quy_che_dao_tao', 'quy_che_v1.md')
    expect(published).toMatchObject({ docKey: 'quy_che_dao_tao', result: { status: 'indexed' }, retired: ['quy_che_v1.md'] })
    expect(live()).toEqual(['quy_che_v2.md:quy_che_dao_tao'])

    const { hits } = await service.search('s2', student, 'điểm trung bình học bổng')
    expect(hits.map(h => h.filename)).toEqual(['quy_che_v2.md'])
    expect(hits[0]!.text).toContain('3.6')
    // A citation to the v1 chunk, retrieved before the switch, is refused.
    expect(() => service.verify('s', student, [{ chunkId: old.chunkId, quote: 'điểm trung bình từ 3.2 trở lên' }])).toThrow(/không còn hiệu lực/)
  })

  it('does not resurrect v1 while its file stays on disk (reconcile, watcher change, re-upload)', async () => {
    putPublic('quy_che_v2.md', V2)
    await service.publishPublic('quy_che_v2.md', 'quy_che_dao_tao', 'quy_che_v1.md')

    await service.watcher.reconcile()
    expect(live()).toEqual(['quy_che_v2.md:quy_che_dao_tao'])
    expect(service.resolve(path.join(root, 'public_docs', 'quy_che_v1.md'))).toBeNull()

    const source = path.join(root, 'blob')
    writeFileSync(source, V1)
    const uploads = await ingestUploads({ id: 's', header: { cwd: path.join(root, 'admin') } },
      [{ attachmentId: 'a', name: 'quy_che_v1.md', bytes: 100 }],
      { storageRoot: root, attachments: { fileHostPath: () => source }, indexer: service.indexer, resolve: service.resolve })
    expect(uploads[0]!.result).toMatchObject({ status: 'rejected', error: expect.stringMatching(/đã bị thay thế/) })
    expect(await searchFiles()).toEqual(['quy_che_v2.md'])
  })

  it('a later edit of the published file versions the same doc_key', async () => {
    putPublic('quy_che_v2.md', V2)
    await service.publishPublic('quy_che_v2.md', 'quy_che_dao_tao', 'quy_che_v1.md')
    putPublic('quy_che_v2.md', `${V2}\n\nĐiều 6. Thư viện mở cửa đến 21h.`)
    await service.watcher.reconcile()
    const rows = service.db.prepare(`SELECT version, status FROM documents WHERE doc_key = 'quy_che_dao_tao' ORDER BY version`).all()
    expect(rows).toEqual([{ version: 1, status: 'superseded' }, { version: 2, status: 'active' }])
  })

  it('publishing a new file to an existing key retires the previously bound file', async () => {
    await service.publishPublic('quy_che_v1.md', 'quy_che_dao_tao')
    putPublic('quy_che_v2.md', V2)
    const result = await service.publishPublic('quy_che_v2.md', 'quy_che_dao_tao')
    expect(result.retired).toEqual(['quy_che_v1.md'])
    expect(live()).toEqual(['quy_che_v2.md:quy_che_dao_tao'])
  })

  it('reindexes the active version on demand', async () => {
    await service.publishPublic('quy_che_v1.md', 'quy_che_dao_tao')
    expect(await service.reindexPublic('quy_che_dao_tao')).toMatchObject({ status: 'indexed', version: 2 })
    await expect(service.reindexPublic('khong_ton_tai')).rejects.toThrow(PublishError)
  })

  it('rejects unsafe or missing names and bad keys', async () => {
    await expect(service.publishPublic('../users/alice/docs/cv.txt', 'x_key')).rejects.toThrow(/không hợp lệ/)
    await expect(service.publishPublic('khong_co.md', 'x_key')).rejects.toThrow(/Không có file/)
    await expect(service.publishPublic('quy_che_v1.md', 'Bad Key')).rejects.toThrow(/doc_key/)
    await expect(service.publishPublic('quy_che_v1.md', 'x_key', 'quy_che_v1.md')).rejects.toThrow(/chính nó/)
  })
})
