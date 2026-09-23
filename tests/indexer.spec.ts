import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { vectorBlob } from '../src/db/database.js'
import { HashEmbedder } from '../src/embed/embedder.js'
import { fileParts, ingestUploads } from '../src/ingest/attachments.js'
import { targetForPath } from '../src/ingest/layout.js'
import { DocShieldService } from '../src/service.js'

let root: string
let service: DocShieldService

beforeEach(() => {
  root = mkdtempSync(path.join(tmpdir(), 'docshield-'))
  for (const dir of ['users/alice/docs', 'users/bob/docs', 'public_docs', 'admin']) mkdirSync(path.join(root, dir), { recursive: true })
  service = new DocShieldService(root, { embedder: new HashEmbedder(), log: () => {}, dbFile: ':memory:' })
})

afterEach(async () => {
  await service.dispose()
  rmSync(root, { recursive: true, force: true })
})

function put(rel: string, content: string): string {
  const file = path.join(root, rel)
  writeFileSync(file, content)
  return file
}

async function ingest(rel: string, content: string) {
  const target = targetForPath(root, put(rel, content))
  if (target === null) throw new Error(`not a document path: ${rel}`)
  return service.indexer.ingest(target)
}

function knn(scope: string, text: string) {
  return service.embedder.embed([text]).then(([v]) => service.db.prepare(
    'SELECT rowid, distance FROM vec_chunks WHERE embedding MATCH ? AND k = 5 AND scope = ?',
  ).all(vectorBlob(v!), scope))
}

describe('Indexer', () => {
  it('indexes into the owner partition only (TC-01 isolation)', async () => {
    expect(await ingest('users/alice/docs/cv_alice.txt', 'Mã số cá nhân của Alice là AL-99')).toMatchObject({ status: 'indexed', chunks: 1 })
    expect(await knn('user:alice', 'mã số cá nhân alice')).toHaveLength(1)
    expect(await knn('user:bob', 'mã số cá nhân alice')).toHaveLength(0)
    expect(await knn('public', 'mã số cá nhân alice')).toHaveLength(0)
    const fts = service.db.prepare("SELECT rowid FROM fts_chunks WHERE fts_chunks MATCH ? AND scope = ?")
    expect(fts.all('"AL-99"', 'user:alice')).toHaveLength(1)
    expect(fts.all('"AL-99"', 'user:bob')).toHaveLength(0)
  })

  it('skips unchanged content and versions changed content', async () => {
    await ingest('public_docs/noi_quy.md', '# Nội quy\nGiữ trật tự.')
    expect(await ingest('public_docs/noi_quy.md', '# Nội quy\nGiữ trật tự.')).toEqual({ status: 'unchanged' })
    expect(await ingest('public_docs/noi_quy.md', '# Nội quy\nGiữ im lặng.')).toMatchObject({ status: 'indexed', version: 2, superseded: 1 })
    const docs = service.db.prepare("SELECT version, status, chunk_count FROM documents WHERE doc_key = 'noi_quy' ORDER BY version").all()
    expect(docs).toEqual([
      { version: 1, status: 'superseded', chunk_count: 0 },
      { version: 2, status: 'active', chunk_count: 1 },
    ])
    expect(service.db.prepare('SELECT COUNT(*) AS n FROM vec_chunks').get()).toEqual({ n: 1 })
    expect(service.db.prepare('SELECT COUNT(*) AS n FROM fts_chunks').get()).toEqual({ n: 1 })
  })

  it('records unreadable files as failed and retires them on removal', async () => {
    expect(await ingest('users/bob/docs/scan.pdf', 'not really a pdf')).toMatchObject({ status: 'failed' })
    expect(service.listDocuments({ role: 'user', userId: 'bob' })).toMatchObject([{ filename: 'scan.pdf', status: 'lỗi' }])
    await service.indexer.remove('user:bob', 'scan')
    expect(service.listDocuments({ role: 'user', userId: 'bob' })).toEqual([])
  })

  it('lists public plus own documents for users and public only for admin', async () => {
    await ingest('users/alice/docs/cv_alice.txt', 'AL-99')
    await ingest('users/bob/docs/cv_bob.txt', 'BO-12')
    await ingest('public_docs/quy_che.md', 'Điều 1. Phạm vi')
    const names = (scope: Parameters<DocShieldService['listDocuments']>[0]) => service.listDocuments(scope).map(d => `${d.scope}:${d.filename}`)
    expect(names({ role: 'user', userId: 'alice' })).toEqual(['chung:quy_che.md', 'cá nhân:cv_alice.txt'])
    expect(names({ role: 'user', userId: 'bob' })).toEqual(['chung:quy_che.md', 'cá nhân:cv_bob.txt'])
    expect(names({ role: 'admin' })).toEqual(['chung:quy_che.md'])
  })

  it('reconciles the folder at startup, including deletions', async () => {
    put('users/alice/docs/a.txt', 'nội dung A')
    put('public_docs/b.md', 'nội dung B')
    put('users/alice/notes.txt', 'không nằm trong docs, bỏ qua')
    await service.watcher.reconcile()
    expect(service.store.listAllLive().map(d => d.filename).sort()).toEqual(['a.txt', 'b.md'])
    rmSync(path.join(root, 'users/alice/docs/a.txt'))
    await service.watcher.reconcile()
    expect(service.store.listAllLive().map(d => d.filename)).toEqual(['b.md'])
  })
})

describe('layout', () => {
  it('maps only direct, safely named children of docs folders', () => {
    expect(targetForPath(root, path.join(root, 'users/alice/docs/cv.txt'))).toMatchObject({ scope: 'user:alice', docKey: 'cv' })
    expect(targetForPath(root, path.join(root, 'public_docs/Quy chế.pdf'))).toMatchObject({ scope: 'public', docKey: 'quy_che' })
    for (const rel of ['users/alice/cv.txt', 'users/alice/docs/sub/cv.txt', 'users/Alice/docs/cv.txt', 'admin/cv.txt', 'public_docs/x.exe', '../x.txt']) {
      expect(targetForPath(root, path.join(root, rel)), rel).toBeNull()
    }
  })
})

describe('chat uploads', () => {
  const session = (cwd: string) => ({ id: 's1', header: { cwd } })

  it('extracts file parts from user messages only', () => {
    const ref = { attachmentId: 'sha256:ab', name: 'cv.txt', bytes: 3 }
    expect(fileParts({ type: 'user/message', data: { content: [{ type: 'text', text: 'hi' }, { type: 'file', attachment: ref }] } })).toEqual([ref])
    expect(fileParts({ type: 'assistant/message', data: { content: [{ type: 'file', attachment: ref }] } })).toEqual([])
  })

  it('copies into the session owner docs folder and indexes', async () => {
    const source = path.join(root, 'blob')
    writeFileSync(source, 'Mã số của Alice là AL-99')
    const ref = { attachmentId: 'sha256:x', name: '../../bob/docs/cv.txt', bytes: 25 }
    const uploads = await ingestUploads(session(path.join(root, 'users/alice')), [ref], {
      storageRoot: root, attachments: { fileHostPath: () => source }, indexer: service.indexer, resolve: service.resolve,
    })
    expect(uploads).toMatchObject([{ filename: 'cv.txt', result: { status: 'indexed' } }])
    expect(service.listDocuments({ role: 'user', userId: 'alice' })).toMatchObject([{ filename: 'cv.txt', scope: 'cá nhân' }])
    expect(service.listDocuments({ role: 'user', userId: 'bob' })).toEqual([])
  })

  it('replaces a same-name re-upload even though DSH attachments are read-only', async () => {
    const deps = (source: string) => ({ storageRoot: root, attachments: { fileHostPath: () => source }, indexer: service.indexer, resolve: service.resolve })
    const v1 = path.join(root, 'blob1')
    const v2 = path.join(root, 'blob2')
    writeFileSync(v1, 'Phiên bản một')
    writeFileSync(v2, 'Phiên bản hai')
    chmodSync(v1, 0o444)
    chmodSync(v2, 0o444)
    const ref = { attachmentId: 'a', name: 'ghi_chu.txt', bytes: 20 }
    await ingestUploads(session(path.join(root, 'users/alice')), [ref], deps(v1))
    const second = await ingestUploads(session(path.join(root, 'users/alice')), [ref], deps(v2))
    expect(second).toMatchObject([{ result: { status: 'indexed', version: 2, superseded: 1 } }])
    expect(readFileSync(path.join(root, 'users/alice/docs/ghi_chu.txt'), 'utf8')).toBe('Phiên bản hai')
  })

  it('routes admin uploads to public_docs and rejects bad files', async () => {
    const source = path.join(root, 'blob')
    writeFileSync(source, 'Điều 1. Quy định chung')
    const deps = { storageRoot: root, attachments: { fileHostPath: () => source }, indexer: service.indexer, resolve: service.resolve }
    const uploads = await ingestUploads(session(path.join(root, 'admin')), [
      { attachmentId: 'a', name: 'quy_che.md', bytes: 20 },
      { attachmentId: 'b', name: 'virus.exe', bytes: 20 },
      { attachmentId: 'c', name: 'big.pdf', bytes: 11 * 1024 * 1024 },
    ], deps)
    expect(uploads.map(u => u.result.status)).toEqual(['indexed', 'rejected', 'rejected'])
    expect(service.listDocuments({ role: 'admin' })).toMatchObject([{ filename: 'quy_che.md', scope: 'chung' }])
  })

  it('ignores uploads outside DocShield workspaces', async () => {
    const uploads = await ingestUploads(session('C:\\somewhere'), [{ attachmentId: 'a', name: 'x.txt', bytes: 1 }], {
      storageRoot: root, attachments: { fileHostPath: () => 'unused' }, indexer: service.indexer, resolve: service.resolve,
    })
    expect(uploads).toEqual([])
  })
})
