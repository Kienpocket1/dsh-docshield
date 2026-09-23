/** Bodies and renderers for publish_public_doc and reindex_document (admin only). */
import type { IngestResult } from '../ingest/indexer.js'
import { PublishError, type DocShieldService, type PublishResult } from '../service.js'
import { ArgumentError, requireString } from './args.js'
import type { ToolBody } from './defs.js'
import { requireScope } from './scope-check.js'

async function asArgumentError<T>(work: () => Promise<T>): Promise<T> {
  try {
    return await work()
  } catch (error) {
    if (error instanceof PublishError) throw new ArgumentError(error.message)
    throw error
  }
}

export function publishBody(service: DocShieldService): ToolBody {
  return async (args, exec) => {
    requireScope(exec, service.storageRoot, 'admin')
    const filename = requireString(args, 'filename', { max: 200 })
    const docKey = requireString(args, 'doc_key', { max: 64 })
    const replaces = typeof args.replaces === 'string' && args.replaces.trim() !== '' ? args.replaces.trim() : undefined
    return asArgumentError(() => service.publishPublic(filename, docKey, replaces))
  }
}

function describe(result: IngestResult): string {
  switch (result.status) {
    case 'indexed': return `đã nạp phiên bản ${result.version} (${result.chunks} đoạn)`
    case 'unchanged': return 'nội dung không đổi'
    case 'failed': return `nạp thất bại: ${result.error}`
    case 'removed': return 'đã gỡ'
  }
}

export function renderPublish(value: unknown): string {
  const { filename, docKey, result, retired } = value as PublishResult
  const replaced = retired.length > 0 ? ` Đã thay thế và ngừng tra cứu: ${retired.join(', ')}.` : ''
  return `Đã công bố ${filename} làm tài liệu chung "${docKey}": ${describe(result)}.${replaced}`
}

export function reindexBody(service: DocShieldService): ToolBody {
  return async (args, exec) => {
    requireScope(exec, service.storageRoot, 'admin')
    const docKey = requireString(args, 'doc_key', { max: 64 })
    const result = await asArgumentError(() => service.reindexPublic(docKey))
    return { docKey, result }
  }
}

export function renderReindex(value: unknown): string {
  const { docKey, result } = value as { docKey: string; result: IngestResult }
  return `Nạp lại "${docKey}": ${describe(result)}.`
}
