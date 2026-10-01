/** Model-facing renderers for scoped_doc_search and answer_with_evidence (bodies: ./calls.ts). */
import type { SearchResult } from '../retrieval/search.js'
import type { VerifiedEvidence } from '../retrieval/evidence.js'

export const NOT_FOUND_SENTENCE = 'Không tìm thấy thông tin này trong tài liệu hiện hành.'

export function renderSearch(value: unknown): string {
  const result = value as SearchResult
  if (result.belowThreshold || result.hits.length === 0) {
    return `KHÔNG CÓ đoạn tài liệu nào đủ liên quan.\nKhông được trả lời từ hiểu biết riêng. Hãy nói "${NOT_FOUND_SENTENCE}" rồi gọi create_support_ticket.`
  }
  const blocks = result.hits.map(hit =>
    `[chunkId ${hit.chunkId}] ${hit.filename} · ${hit.locator} (tài liệu ${hit.scope}, độ liên quan ${hit.similarity})\n${hit.text}`)
  return [
    `Tìm thấy ${result.hits.length} đoạn. Chỉ dùng đoạn thực sự trả lời câu hỏi; nếu không đoạn nào trả lời được, nói "${NOT_FOUND_SENTENCE}" và gọi create_support_ticket.`,
    ...blocks,
  ].join('\n\n---\n\n')
}

export interface AnswerValue {
  readonly answer: string
  readonly evidence: readonly VerifiedEvidence[]
}

export function renderAnswer(value: unknown): string {
  const { evidence } = value as AnswerValue
  const sources = [...new Set(evidence.map(e => `${e.filename} · ${e.locator}`))].join('; ')
  return `Đã xác minh ${evidence.length} trích dẫn (${sources}). Thẻ bằng chứng đã hiển thị cho người dùng. Chỉ nhắc lại câu trả lời thật ngắn kèm [Nguồn: ...], không thêm thông tin mới.`
}
