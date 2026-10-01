import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { HashEmbedder } from '../src/embed/embedder.js'
import { targetForPath } from '../src/ingest/layout.js'
import { EvidenceError, normalizeQuote } from '../src/retrieval/evidence.js'
import { identifierTokens, toFtsQuery } from '../src/retrieval/search.js'
import type { DocScope } from '../src/scope.js'
import { DocShieldService } from '../src/service.js'

let root: string
let service: DocShieldService
const alice: DocScope = { role: 'user', userId: 'alice' }
const bob: DocScope = { role: 'user', userId: 'bob' }
const admin: DocScope = { role: 'admin' }

async function put(rel: string, content: string) {
  const file = path.join(root, rel)
  writeFileSync(file, content)
  await service.indexer.ingest(targetForPath(root, file)!)
}

beforeEach(async () => {
  root = mkdtempSync(path.join(tmpdir(), 'docshield-r-'))
  for (const dir of ['users/alice/docs', 'users/bob/docs', 'public_docs']) mkdirSync(path.join(root, dir), { recursive: true })
  // HashEmbedder similarities are bag-of-words overlaps, so use a low floor here.
  service = new DocShieldService(root, { embedder: new HashEmbedder(), log: () => {}, dbFile: ':memory:', minSimilarity: 0.2 })
  await put('users/alice/docs/cv_alice.txt', 'Mã số cá nhân của Alice là AL-99.')
  await put('users/bob/docs/cv_bob.txt', 'Mã số cá nhân của Bob là BO-12.')
  await put('public_docs/quy_che.md', 'Điều 5. Học bổng\nSinh viên có điểm trung bình từ 3.2 trở lên được xét học bổng khuyến khích.\n\nĐiều 6. Thư viện\nThư viện mở cửa từ 7h30 đến 21h.')
})

afterEach(async () => {
  await service.dispose()
  rmSync(root, { recursive: true, force: true })
})

describe('scoped search (TC-01)', () => {
  it('finds the owner document', async () => {
    const { hits } = await service.search('s-alice', alice, 'mã số cá nhân của tôi')
    expect(hits[0]).toMatchObject({ filename: 'cv_alice.txt', scope: 'cá nhân' })
    expect(hits.map(h => h.filename)).not.toContain('cv_bob.txt')
  })

  it('never returns another user document, even for a targeted query', async () => {
    for (const q of ['Mã số cá nhân của Alice là gì', 'AL-99', 'alice']) {
      const { hits } = await service.search('s-bob', bob, q)
      expect(hits.map(h => h.filename), q).not.toContain('cv_alice.txt')
    }
  })

  it('gives admin public documents only', async () => {
    const { hits } = await service.search('s-admin', admin, 'mã số cá nhân')
    expect(hits.every(h => h.scope === 'chung')).toBe(true)
  })

  it('matches identifiers lexically even when semantically weak', async () => {
    const { hits } = await service.search('s-alice', alice, 'AL-99')
    expect(hits[0]?.filename).toBe('cv_alice.txt')
  })

  it('returns belowThreshold for unrelated questions', async () => {
    const result = await service.search('s-alice', alice, 'xe máy trả góp lãi suất')
    expect(result).toEqual({ hits: [], belowThreshold: true })
  })
})

describe('answer_with_evidence verification', () => {
  async function firstHit(session: string, scope: DocScope, q: string) {
    const { hits } = await service.search(session, scope, q)
    return hits[0]!
  }

  it('accepts a verbatim quote from a chunk returned in this session', async () => {
    const hit = await firstHit('s1', alice, 'mã số cá nhân')
    const evidence = service.verify('s1', alice, [{ chunkId: hit.chunkId, quote: '“mã số cá nhân của  Alice là AL-99.”' }])
    expect(evidence).toEqual([{ chunkId: hit.chunkId, filename: 'cv_alice.txt', locator: 'đoạn 1', scope: 'cá nhân', quote: '“mã số cá nhân của  Alice là AL-99.”' }])
  })

  it('rejects chunks never returned in this session', async () => {
    const hit = await firstHit('s1', alice, 'mã số cá nhân')
    expect(() => service.verify('s2', alice, [{ chunkId: hit.chunkId, quote: 'Mã số cá nhân của Alice' }])).toThrow(/chưa được scoped_doc_search trả về/)
    expect(() => service.verify('s1', alice, [{ chunkId: '999', quote: 'Mã số cá nhân của Alice' }])).toThrow(EvidenceError)
  })

  it('rejects paraphrases and fabricated quotes', async () => {
    const hit = await firstHit('s1', alice, 'mã số cá nhân')
    expect(() => service.verify('s1', alice, [{ chunkId: hit.chunkId, quote: 'Alice có mã số AL-99' }])).toThrow(/không khớp nguyên văn/)
    expect(() => service.verify('s1', alice, [{ chunkId: hit.chunkId, quote: 'AL-99' }])).toThrow(/quá ngắn/)
  })

  it('rejects a chunk outside the current scope even if it was recorded', async () => {
    const hit = await firstHit('shared', alice, 'mã số cá nhân')
    expect(() => service.verify('shared', bob, [{ chunkId: hit.chunkId, quote: 'Mã số cá nhân của Alice' }])).toThrow(/không còn hiệu lực/)
  })

  it('rejects chunks of a replaced document (TC-05 groundwork)', async () => {
    const hit = await firstHit('s1', alice, 'học bổng điểm trung bình')
    await put('public_docs/quy_che.md', 'Điều 5. Học bổng\nSinh viên có điểm trung bình từ 3.6 trở lên được xét học bổng.')
    expect(() => service.verify('s1', alice, [{ chunkId: hit.chunkId, quote: 'điểm trung bình từ 3.2 trở lên' }])).toThrow(/không còn hiệu lực/)
  })
})

describe('query helpers', () => {
  it('builds a safe FTS query', () => {
    expect(toFtsQuery('Điểm "3.2" OR drop; học bổng?')).toBe('"Điểm" OR "3.2" OR "OR" OR "drop" OR "học" OR "bổng"')
    expect(toFtsQuery('?! a')).toBe('')
  })
  it('extracts identifier tokens', () => {
    expect(identifierTokens('Mã AL-99 và 3.2, không phải abc')).toEqual(['al-99', '3.2'])
  })
  it('normalises quotes', () => {
    expect(normalizeQuote('  “Sinh viên   có điểm…” ')).toBe('sinh viên có điểm')
  })
})
