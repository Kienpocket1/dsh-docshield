/** Bindings for files in public_docs: explicit doc_key or retired (see schema v3). */
import type { DatabaseSync } from 'node:sqlite'

export interface PublicBinding {
  readonly filename: string
  readonly doc_key: string
  readonly state: 'bound' | 'retired'
}

export class PublicFiles {
  constructor(private readonly db: DatabaseSync) {}

  get(filename: string): PublicBinding | undefined {
    return this.db.prepare('SELECT filename, doc_key, state FROM public_files WHERE filename = ?').get(filename) as PublicBinding | undefined
  }

  /** Files currently bound to `docKey`. */
  boundTo(docKey: string): string[] {
    return (this.db.prepare(`SELECT filename FROM public_files WHERE doc_key = ? AND state = 'bound'`).all(docKey) as { filename: string }[])
      .map(r => r.filename)
  }

  retiredFilenames(): string[] {
    return (this.db.prepare(`SELECT filename FROM public_files WHERE state = 'retired'`).all() as { filename: string }[]).map(r => r.filename)
  }

  /** Upsert; caller owns the transaction. */
  set(filename: string, docKey: string, state: 'bound' | 'retired'): void {
    this.db.prepare(`
      INSERT INTO public_files (filename, doc_key, state) VALUES (?, ?, ?)
      ON CONFLICT (filename) DO UPDATE SET doc_key = excluded.doc_key, state = excluded.state,
        updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`).run(filename, docKey, state)
  }
}
