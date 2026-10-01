/** Model-facing renderers for publish_public_doc and reindex_document (bodies: ./calls.ts). */
import type { IngestResult } from '../ingest/indexer.js'
import type { PublishResult } from '../service.js'

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

export function renderReindex(value: unknown): string {
  const { docKey, result } = value as { docKey: string; result: IngestResult }
  return `Nạp lại "${docKey}": ${describe(result)}.`
}
