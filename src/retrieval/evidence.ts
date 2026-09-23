/**
 * Evidence ledger and citation check. `scoped_doc_search` records every
 * chunk it returns per session; `answer_with_evidence` accepts a citation
 * only if (1) that chunk was returned in the same session, (2) it still
 * belongs to an active document in a scope the session may read, and
 * (3) the quote is a verbatim substring of the chunk (modulo whitespace,
 * case and Unicode normalisation).
 */
import type { DatabaseSync } from 'node:sqlite'
import { PUBLIC_SCOPE } from '../ingest/layout.js'
import type { SearchHit } from './search.js'

const MAX_SESSIONS = 500
const MAX_CHUNKS_PER_SESSION = 300
export const MIN_QUOTE_CHARS = 8

export interface Citation {
  readonly chunkId: string
  readonly quote: string
}

export interface VerifiedEvidence {
  readonly chunkId: string
  readonly filename: string
  readonly locator: string
  readonly scope: 'chung' | 'cá nhân'
  readonly quote: string
}

export class EvidenceError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EvidenceError'
  }
}

export class EvidenceLedger {
  // Map iteration order doubles as LRU order.
  private readonly sessions = new Map<string, Set<string>>()

  record(sessionId: string, hits: readonly SearchHit[]): void {
    const seen = this.sessions.get(sessionId) ?? new Set<string>()
    this.sessions.delete(sessionId)
    for (const hit of hits) {
      seen.delete(hit.chunkId)
      seen.add(hit.chunkId)
    }
    while (seen.size > MAX_CHUNKS_PER_SESSION) seen.delete(seen.values().next().value!)
    this.sessions.set(sessionId, seen)
    while (this.sessions.size > MAX_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!)
  }

  has(sessionId: string, chunkId: string): boolean {
    return this.sessions.get(sessionId)?.has(chunkId) ?? false
  }
}

export function verifyCitations(
  db: DatabaseSync,
  ledger: EvidenceLedger,
  sessionId: string,
  readable: readonly string[],
  citations: readonly Citation[],
): VerifiedEvidence[] {
  if (citations.length === 0) throw new EvidenceError('Cần ít nhất một trích dẫn.')
  const load = db.prepare(`
    SELECT c.text, c.locator, d.filename, d.scope
    FROM chunks c JOIN documents d ON d.id = c.document_id
    WHERE c.id = ? AND d.status = 'active'`)
  const allowed = new Set(readable)
  return citations.map(({ chunkId, quote }) => {
    if (!/^\d+$/.test(chunkId) || !ledger.has(sessionId, chunkId)) {
      throw new EvidenceError(`chunkId ${JSON.stringify(chunkId)} chưa được scoped_doc_search trả về trong phiên này. Hãy tìm lại rồi trích từ kết quả.`)
    }
    const row = load.get(Number(chunkId)) as { text: string; locator: string; filename: string; scope: string } | undefined
    if (row === undefined || !allowed.has(row.scope)) {
      throw new EvidenceError(`Đoạn ${chunkId} không còn hiệu lực (tài liệu đã được thay hoặc gỡ). Hãy tìm lại.`)
    }
    const needle = normalizeQuote(quote)
    if (needle.length < MIN_QUOTE_CHARS) {
      throw new EvidenceError(`Trích dẫn cho đoạn ${chunkId} quá ngắn; cần câu nguyên văn ít nhất ${MIN_QUOTE_CHARS} ký tự.`)
    }
    if (!normalizeQuote(row.text).includes(needle)) {
      throw new EvidenceError(`Trích dẫn cho đoạn ${chunkId} không khớp nguyên văn với tài liệu "${row.filename}". Chỉ được trích đúng chữ trong đoạn.`)
    }
    return {
      chunkId,
      filename: row.filename,
      locator: row.locator,
      scope: row.scope === PUBLIC_SCOPE ? 'chung' : 'cá nhân',
      quote: quote.trim(),
    }
  })
}

/** NFC, lower-case, collapse whitespace, drop surrounding quotes, ellipses and punctuation. */
export function normalizeQuote(text: string): string {
  return text
    .normalize('NFC')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .replace(/^[\s"'“”‘’«»….,;:!?()[\]-]+|[\s"'“”‘’«»….,;:!?()[\]-]+$/gu, '')
}
