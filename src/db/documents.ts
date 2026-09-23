/** Document/chunk persistence. Every write keeps documents, chunks, vec and FTS rows consistent. */
import type { DatabaseSync } from 'node:sqlite'
import { transaction, vectorBlob } from './database.js'

export type DocumentStatus = 'active' | 'superseded' | 'removed' | 'failed'

export interface DocumentRow {
  readonly id: number
  readonly scope: string
  readonly doc_key: string
  readonly filename: string
  readonly path: string
  readonly sha256: string
  readonly bytes: number
  readonly version: number
  readonly status: DocumentStatus
  readonly error: string | null
  readonly chunk_count: number
  readonly created_at: string
}

export interface NewChunk {
  readonly ord: number
  readonly text: string
  readonly locator: string
  readonly embedding: Float32Array
}

export interface DocumentIdentity {
  readonly scope: string
  readonly docKey: string
  readonly filename: string
  readonly path: string
  readonly sha256: string
  readonly bytes: number
}

export class DocumentStore {
  constructor(private readonly db: DatabaseSync) {}

  /** The newest active or failed version of a document, if any. */
  current(scope: string, docKey: string): DocumentRow | undefined {
    return this.db.prepare(`
      SELECT * FROM documents
      WHERE scope = ? AND doc_key = ? AND status IN ('active', 'failed')
      ORDER BY version DESC LIMIT 1`).get(scope, docKey) as DocumentRow | undefined
  }

  /**
   * Insert a new active version with its chunks and index rows, and retire
   * every older live version of the same (scope, doc_key) in one transaction.
   * @returns the ids of the versions it superseded.
   */
  insertActive(identity: DocumentIdentity, chunks: readonly NewChunk[]): { id: number; version: number; superseded: number[] } {
    return transaction(this.db, () => {
      const version = this.nextVersion(identity.scope, identity.docKey)
      const superseded = this.retire(identity.scope, identity.docKey, 'superseded')
      const { lastInsertRowid } = this.db.prepare(`
        INSERT INTO documents (scope, doc_key, filename, path, sha256, bytes, version, status, chunk_count)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?)`).run(
        identity.scope, identity.docKey, identity.filename, identity.path, identity.sha256, identity.bytes, version, chunks.length,
      )
      const documentId = Number(lastInsertRowid)
      const insertChunk = this.db.prepare('INSERT INTO chunks (document_id, ord, text, locator) VALUES (?, ?, ?, ?)')
      const insertVec = this.db.prepare('INSERT INTO vec_chunks (rowid, scope, embedding) VALUES (?, ?, ?)')
      const insertFts = this.db.prepare('INSERT INTO fts_chunks (rowid, text, scope) VALUES (?, ?, ?)')
      for (const chunk of chunks) {
        const chunkId = BigInt(insertChunk.run(documentId, chunk.ord, chunk.text, chunk.locator).lastInsertRowid)
        insertVec.run(chunkId, identity.scope, vectorBlob(chunk.embedding))
        insertFts.run(chunkId, chunk.text, identity.scope)
      }
      return { id: documentId, version, superseded }
    })
  }

  /** Record a failed ingestion (no chunks) as the newest version, retiring older live versions. */
  insertFailed(identity: DocumentIdentity, error: string): void {
    transaction(this.db, () => {
      const version = this.nextVersion(identity.scope, identity.docKey)
      this.retire(identity.scope, identity.docKey, 'superseded')
      this.db.prepare(`
        INSERT INTO documents (scope, doc_key, filename, path, sha256, bytes, version, status, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'failed', ?)`).run(
        identity.scope, identity.docKey, identity.filename, identity.path, identity.sha256, identity.bytes, version, error,
      )
    })
  }

  /** Mark every live version removed (file deleted) and drop its index rows. */
  remove(scope: string, docKey: string): number[] {
    return transaction(this.db, () => this.retire(scope, docKey, 'removed'))
  }

  /** Live documents (active + failed) in the given scopes, newest first. */
  listLive(scopes: readonly string[]): DocumentRow[] {
    if (scopes.length === 0) return []
    const marks = scopes.map(() => '?').join(', ')
    return this.db.prepare(`
      SELECT * FROM documents
      WHERE scope IN (${marks}) AND status IN ('active', 'failed')
      ORDER BY scope, filename`).all(...scopes) as unknown as DocumentRow[]
  }

  /** Live documents indexed from exactly this file path. */
  liveByPath(filePath: string): DocumentRow[] {
    return this.db.prepare(`SELECT * FROM documents WHERE path = ? AND status IN ('active', 'failed')`).all(filePath) as unknown as DocumentRow[]
  }

  /** Every live document in every scope (used by the startup reconcile). */
  listAllLive(): DocumentRow[] {
    return this.db.prepare(`SELECT * FROM documents WHERE status IN ('active', 'failed')`).all() as unknown as DocumentRow[]
  }

  private nextVersion(scope: string, docKey: string): number {
    const row = this.db.prepare('SELECT MAX(version) AS v FROM documents WHERE scope = ? AND doc_key = ?').get(scope, docKey) as { v: number | null }
    return (row.v ?? 0) + 1
  }

  /** Move live versions to `status` and delete their chunk, vec and FTS rows. Caller owns the transaction. */
  private retire(scope: string, docKey: string, status: 'superseded' | 'removed'): number[] {
    const live = this.db.prepare(`
      SELECT id FROM documents WHERE scope = ? AND doc_key = ? AND status IN ('active', 'failed')`).all(scope, docKey) as { id: number }[]
    const deleteVec = this.db.prepare('DELETE FROM vec_chunks WHERE rowid = ?')
    const deleteFts = this.db.prepare('DELETE FROM fts_chunks WHERE rowid = ?')
    for (const { id } of live) {
      const chunkIds = this.db.prepare('SELECT id FROM chunks WHERE document_id = ?').all(id) as { id: number }[]
      for (const chunk of chunkIds) {
        deleteVec.run(BigInt(chunk.id))
        deleteFts.run(BigInt(chunk.id))
      }
      this.db.prepare('DELETE FROM chunks WHERE document_id = ?').run(id)
      this.db.prepare('UPDATE documents SET status = ?, chunk_count = 0 WHERE id = ?').run(status, id)
    }
    return live.map(row => row.id)
  }
}
