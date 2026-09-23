/**
 * DocShield host row (`docshield-core`): publishes the `docshield` service,
 * installs the global tool guard, keeps the index in step with storage, and
 * ingests files attached in DocShield sessions. Tools mount per agent through
 * the `docshield` / `docshield-admin` presets (see `./tools`).
 */
import { resolveCoreConfig } from './config.js'
import type { AgentHandleView, DshContext } from './dsh-types.js'
import { createGuard } from './guard.js'
import { describeUploads, fileParts, ingestUploads, type AttachmentsView } from './ingest/attachments.js'
import { DocShieldService } from './service.js'

export const name = 'docshield-core'

export function apply(ctx: DshContext, rawConfig?: unknown): void {
  const config = resolveCoreConfig(rawConfig)
  const service = new DocShieldService(config.storageRoot, { minSimilarity: config.minSimilarity, topK: config.topK })
  ctx.effect(() => () => service.dispose(), 'docshield: service lifetime')
  ctx.provide('docshield', service)

  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.effect(() => toolsCtx.tools.guard(createGuard(config.storageRoot)), 'docshield: tool guard')
  })

  void service.watcher.reconcile()
    .then(() => service.watcher.start())
    .catch(error => service.log(`startup reconcile failed: ${error instanceof Error ? error.message : String(error)}`))

  ctx.on('session/event', (session, event) => {
    const refs = fileParts(event)
    if (refs.length === 0) return
    const attachments = ctx.get('attachments') as AttachmentsView | undefined
    if (attachments === undefined) {
      service.log('attachments service unavailable; upload not ingested')
      return
    }
    const onAccepted = (filename: string) => {
      service.log(`nhận file đính kèm ${filename} (phiên ${session.id})`)
      notifyAgent(ctx, session.id, `[DocShield] Đã nhận "${filename}" và đang nạp. Tài liệu dài có thể mất vài phút; trong lúc đó list_documents hiện "đang nạp" kèm tiến độ. Đừng kết luận là tài liệu bị thiếu — hãy báo người dùng chờ nạp xong.`)
    }
    void ingestUploads(session, refs, { storageRoot: config.storageRoot, attachments, indexer: service.indexer, resolve: service.resolve, onAccepted })
      .then((uploads) => {
        if (uploads.length === 0) return
        const summary = describeUploads(uploads)
        service.log(summary.replaceAll('\n', ' | '))
        notifyAgent(ctx, session.id, summary)
      })
      .catch(error => service.log(`upload ingest failed: ${error instanceof Error ? error.message : String(error)}`))
  })
}

/** Tell the session's agent what happened to its uploads (seen on its next request). Best effort. */
function notifyAgent(ctx: DshContext, sessionId: string, text: string): void {
  try {
    const agents = ctx.get('agents') as { get?(id: string): AgentHandleView | undefined } | undefined
    agents?.get?.(sessionId)?.inject?.({ content: [{ type: 'text', text }], source: { kind: 'plugin', plugin: 'docshield' } })
  } catch {
    // The agent may be idle-disposed; list_documents still shows the result.
  }
}
