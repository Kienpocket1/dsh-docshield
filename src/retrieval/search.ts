/**
 * Hybrid retrieval over the scopes a session may read:
 *   - vector KNN per scope partition (bge-m3, cosine)
 *   - BM25 over FTS5 restricted to the same scopes
 * fused with Reciprocal Rank Fusion. A candidate survives if its cosine
 * similarity clears `minSimilarity`, if it shares an identifier-like token
 * (digits, e.g. "AL-99", "3.2") with the query, or if it is in the BM25 top 5
 * and within 0.1 of the floor — accent-less or terse text (e.g. "Ma so ca nhan
 * cua Alice") embeds weakly but matches lexically (calibration, M3).
 *
 * The similarity floor is a coarse filter, not the evidence decision: M0
 * showed a trap question scoring as high as a real one. Whether a passage
 * actually answers is enforced by answer_with_evidence + the persona.
 */
import type { DatabaseSync } from 'node:sqlite'
import { vectorBlob } from '../db/database.js'
import type { Embedder } from '../embed/embedder.js'
import { PUBLIC_SCOPE } from '../ingest/layout.js'

export interface SearchOptions {
  readonly k: number
  readonly minSimilarity: number
}

export interface SearchHit {
  readonly chunkId: string
  readonly filename: string
  readonly locator: string
  readonly scope: 'chung' | 'cá nhân'
  /** Cosine similarity to the query, rounded to 3 decimals. */
  readonly similarity: number
  /** Full chunk text: the only text the model may quote from. */
  readonly text: string
}

export interface SearchResult {
  readonly hits: SearchHit[]
  /** True when nothing cleared the filter; the model must not answer from memory. */
  readonly belowThreshold: boolean
}

const CANDIDATES = 20
const RRF_K = 60
/** A chunk in the BM25 top-N may pass with a similarity up to LEXICAL_RELIEF below the floor. */
const LEXICAL_TOP = 5
const LEXICAL_RELIEF = 0.1

interface Row {
  id: number
  text: string
  locator: string
  filename: string
  scope: string
}

export async function hybridSearch(
  db: DatabaseSync,
  embedder: Embedder,
  scopes: readonly string[],
  query: string,
  options: SearchOptions,
): Promise<SearchResult> {
  const [queryVector] = await embedder.embed([query])
  if (queryVector === undefined || scopes.length === 0) return { hits: [], belowThreshold: true }
  const blob = vectorBlob(queryVector)

  const rankings: number[][] = []
  const similarity = new Map<number, number>()
  const lexicalRank = new Map<number, number>()
  const knn = db.prepare(`
    SELECT rowid AS id, distance FROM vec_chunks
    WHERE embedding MATCH ? AND k = ? AND scope = ?
    ORDER BY distance`)
  const vectorRanked: { id: number; distance: number }[] = []
  for (const scope of scopes) vectorRanked.push(...knn.all(blob, CANDIDATES, scope) as { id: number; distance: number }[])
  vectorRanked.sort((a, b) => a.distance - b.distance)
  rankings.push(vectorRanked.map(r => r.id))
  for (const r of vectorRanked) similarity.set(r.id, 1 - r.distance)

  const ftsQuery = toFtsQuery(query)
  if (ftsQuery !== '') {
    const marks = scopes.map(() => '?').join(', ')
    const lexical = db.prepare(`
      SELECT rowid AS id FROM fts_chunks
      WHERE fts_chunks MATCH ? AND scope IN (${marks})
      ORDER BY bm25(fts_chunks) LIMIT ?`).all(ftsQuery, ...scopes, CANDIDATES) as { id: number }[]
    rankings.push(lexical.map(r => r.id))
    lexical.forEach((r, rank) => lexicalRank.set(r.id, rank))
    // Lexical-only candidates still need a similarity for gating and display.
    const distance = db.prepare('SELECT vec_distance_cosine(embedding, ?) AS d FROM vec_chunks WHERE rowid = ?')
    for (const { id } of lexical) {
      if (!similarity.has(id)) {
        const row = distance.get(blob, BigInt(id)) as { d: number } | undefined
        if (row !== undefined) similarity.set(id, 1 - row.d)
      }
    }
  }

  const fused = new Map<number, number>()
  for (const ranking of rankings) {
    ranking.forEach((id, rank) => fused.set(id, (fused.get(id) ?? 0) + 1 / (RRF_K + rank + 1)))
  }
  const ordered = [...fused.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id)

  const identifiers = identifierTokens(query)
  const load = db.prepare(`
    SELECT c.id, c.text, c.locator, d.filename, d.scope
    FROM chunks c JOIN documents d ON d.id = c.document_id
    WHERE c.id = ? AND d.status = 'active'`)
  const allowed = new Set(scopes)
  const hits: SearchHit[] = []
  for (const id of ordered) {
    if (hits.length >= options.k) break
    const row = load.get(id) as Row | undefined
    if (row === undefined || !allowed.has(row.scope)) continue
    const sim = similarity.get(id) ?? 0
    const identifierMatch = identifiers.some(token => normalizeForMatch(row.text).includes(token))
    // Strong BM25 support relaxes the floor: accent-less or terse text embeds weakly.
    const lexicalSupport = (lexicalRank.get(id) ?? Infinity) < LEXICAL_TOP && sim >= options.minSimilarity - LEXICAL_RELIEF
    if (sim < options.minSimilarity && !identifierMatch && !lexicalSupport) continue
    hits.push({
      chunkId: String(row.id),
      filename: row.filename,
      locator: row.locator,
      scope: row.scope === PUBLIC_SCOPE ? 'chung' : 'cá nhân',
      similarity: Math.round(sim * 1000) / 1000,
      text: row.text,
    })
  }
  return { hits, belowThreshold: hits.length === 0 }
}

/** OR of quoted query words (FTS5 syntax is never passed through raw). */
export function toFtsQuery(query: string): string {
  const words = query.normalize('NFC').match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) ?? []
  const unique = [...new Set(words.map(w => w.replace(/[._-]+$/u, '')).filter(w => w.length >= 2))]
  return unique.slice(0, 24).map(w => `"${w.replaceAll('"', '')}"`).join(' OR ')
}

/** Tokens containing a digit (codes, numbers), normalised for substring matching. */
export function identifierTokens(query: string): string[] {
  const tokens = query.match(/[\p{L}\p{N}][\p{L}\p{N}._-]*/gu) ?? []
  return [...new Set(tokens.filter(t => /\d/.test(t) && t.length >= 2).map(normalizeForMatch))]
}

export function normalizeForMatch(text: string): string {
  return text.normalize('NFC').toLowerCase().replace(/\s+/g, ' ')
}
