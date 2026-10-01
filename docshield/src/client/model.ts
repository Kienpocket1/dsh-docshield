/**
 * Browser-side view of a tool call block (ui-conversation's ToolCallBlock):
 * running calls carry only `argsRaw`; settled ones carry `kind: 'tool-result'`,
 * content, error state and the persisted presentationMeta (`meta`), which is
 * the tool's canonical value — so cards replay identically from the log.
 */
export interface ContentBlockView {
  readonly type: string
  readonly text?: string
}

export interface ToolBlockView {
  readonly kind?: string
  readonly argsRaw?: string
  readonly call?: { readonly argsRaw: string } | null
  readonly content?: readonly ContentBlockView[]
  readonly isError?: boolean
  readonly meta?: unknown
}

export interface CallState<M> {
  readonly settled: boolean
  readonly args: Record<string, unknown>
  readonly meta: M | undefined
  readonly error: string | undefined
}

export function readCall<M>(block: ToolBlockView | undefined, isMeta: (value: unknown) => value is M): CallState<M> {
  const raw = block?.kind === 'tool-result' ? block.call?.argsRaw : block?.argsRaw
  let args: Record<string, unknown> = {}
  try {
    const parsed: unknown = JSON.parse(raw ?? '{}')
    if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) args = parsed as Record<string, unknown>
  } catch {
    // Streaming or malformed arguments: render without them.
  }
  const settled = block?.kind === 'tool-result'
  const text = (block?.content ?? []).map(c => c.text ?? '').join('\n').trim()
  if (!settled) return { settled, args, meta: undefined, error: undefined }
  if (block?.isError) return { settled, args, meta: undefined, error: text || 'Công cụ báo lỗi.' }
  return { settled, args, meta: isMeta(block?.meta) ? block.meta : undefined, error: undefined }
}

export const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
export const str = (v: unknown): string => (typeof v === 'string' ? v : '')

export interface EvidenceItem { filename: string; locator: string; scope: string; quote: string }
export interface AnswerMeta { answer: string; evidence: EvidenceItem[] }
export const isAnswerMeta = (v: unknown): v is AnswerMeta =>
  isRecord(v) && typeof v.answer === 'string' && Array.isArray(v.evidence) && v.evidence.every(e => isRecord(e) && typeof e.quote === 'string')

export interface SearchHitView { chunkId: string; filename: string; locator: string; scope: string; similarity: number }
export interface SearchMeta { hits: SearchHitView[]; belowThreshold: boolean }
export const isSearchMeta = (v: unknown): v is SearchMeta => isRecord(v) && Array.isArray(v.hits) && typeof v.belowThreshold === 'boolean'

export interface TicketView {
  code: string; userId: string; question: string; reason: string
  status: 'open' | 'in_progress' | 'resolved' | 'rejected'; statusLabel: string; adminReply: string | null
  createdAt: string; updatedAt: string
}
const isTicket = (v: unknown): v is TicketView => isRecord(v) && typeof v.code === 'string' && typeof v.statusLabel === 'string'
export type TicketMeta = { ticket: TicketView; reused?: boolean } | { found: false; code: string }
export const isTicketMeta = (v: unknown): v is TicketMeta =>
  isRecord(v) && (isTicket(v.ticket) || (v.found === false && typeof v.code === 'string'))
export interface TicketListMeta { count: number; tickets: TicketView[] }
export const isTicketListMeta = (v: unknown): v is TicketListMeta => isRecord(v) && Array.isArray(v.tickets) && v.tickets.every(isTicket)

export interface DocumentView { filename: string; docKey: string; scope: string; status: string; version: number; chunks: number; updatedAt: string; error?: string; progress?: string }
export interface DocListMeta { count: number; documents: DocumentView[] }
export const isDocListMeta = (v: unknown): v is DocListMeta => isRecord(v) && Array.isArray(v.documents)

export interface IngestView { status: string; version?: number; chunks?: number; error?: string }
export interface PublishMeta { filename: string; docKey: string; result: IngestView; retired: string[] }
export const isPublishMeta = (v: unknown): v is PublishMeta => isRecord(v) && typeof v.docKey === 'string' && isRecord(v.result) && Array.isArray(v.retired)
export interface ReindexMeta { docKey: string; result: IngestView }
export const isReindexMeta = (v: unknown): v is ReindexMeta => isRecord(v) && typeof v.docKey === 'string' && isRecord(v.result)

export function formatTime(iso: string): string {
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' })
}
