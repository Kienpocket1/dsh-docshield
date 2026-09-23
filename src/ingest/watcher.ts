/**
 * Keep the index in step with the filesystem: a startup reconcile (index new
 * or changed files, retire documents whose file vanished or was retired) plus
 * a recursive fs.watch with per-path debounce for later changes. Every path is
 * mapped through the binding-aware resolver, so a retired public file is never
 * indexed again while it stays on disk.
 */
import { existsSync, watch, type FSWatcher } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import path from 'node:path'
import type { DocumentStore } from '../db/documents.js'
import type { Indexer } from './indexer.js'
import { PUBLIC_SCOPE, targetForPath, type TargetResolver } from './layout.js'

const DEBOUNCE_MS = 1000

export class StorageWatcher {
  private watcher: FSWatcher | undefined
  private readonly timers = new Map<string, NodeJS.Timeout>()

  constructor(
    private readonly storageRoot: string,
    private readonly resolve: TargetResolver,
    private readonly indexer: Indexer,
    private readonly store: DocumentStore,
    private readonly retiredPublic: () => string[],
    private readonly log: (message: string) => void,
  ) {}

  async reconcile(): Promise<void> {
    const files: string[] = []
    const usersDir = path.join(this.storageRoot, 'users')
    for (const user of await safeReaddir(usersDir)) {
      const docs = path.join(usersDir, user, 'docs')
      for (const name of await safeReaddir(docs)) files.push(path.join(docs, name))
    }
    const publicDir = path.join(this.storageRoot, 'public_docs')
    for (const name of await safeReaddir(publicDir)) files.push(path.join(publicDir, name))

    for (const file of files) {
      const target = this.resolve(file)
      if (target === null || !(await stat(file)).isFile()) continue
      await this.indexer.ingest(target)
    }
    const retired = new Set(this.retiredPublic())
    for (const doc of this.store.listAllLive()) {
      const gone = !existsSync(doc.path)
      const retiredFile = doc.scope === PUBLIC_SCOPE && retired.has(doc.filename)
      if (gone || retiredFile) await this.indexer.remove(doc.scope, doc.doc_key)
    }
  }

  start(): void {
    if (this.watcher !== undefined) return
    this.watcher = watch(this.storageRoot, { recursive: true }, (_event, name) => {
      if (name === null) return
      const file = path.join(this.storageRoot, name.toString())
      if (targetForPath(this.storageRoot, file) === null) return
      clearTimeout(this.timers.get(file))
      this.timers.set(file, setTimeout(() => {
        this.timers.delete(file)
        void this.settle(file)
      }, DEBOUNCE_MS))
    })
    this.watcher.on('error', error => this.log(`watcher error: ${error.message}`))
  }

  close(): void {
    this.watcher?.close()
    this.watcher = undefined
    for (const timer of this.timers.values()) clearTimeout(timer)
    this.timers.clear()
  }

  private async settle(file: string): Promise<void> {
    try {
      const info = await stat(file).catch(() => undefined)
      if (info === undefined) {
        // Deleted: retire whatever live document was indexed from this exact path.
        for (const doc of this.store.liveByPath(path.resolve(file))) await this.indexer.remove(doc.scope, doc.doc_key)
        return
      }
      const target = this.resolve(file)
      if (target !== null && info.isFile()) await this.indexer.ingest(target)
    } catch (error) {
      this.log(`watch ingest failed for ${file}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

async function safeReaddir(dir: string): Promise<string[]> {
  try {
    return await readdir(dir)
  } catch {
    return []
  }
}
