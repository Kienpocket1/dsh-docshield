/** DocShield chat cards. Pure functions of the call block (replay-safe); only the ticket button acts. */
import { useState } from 'react'
import {
  formatTime, isAnswerMeta, isDocListMeta, isPublishMeta, isReindexMeta, isSearchMeta, isTicketListMeta, isTicketMeta,
  readCall, str, type IngestView, type TicketView, type ToolBlockView,
} from './model.js'

export interface CardProps {
  readonly block?: ToolBlockView
  readonly toolName?: string
  /** Supplied by the registration's inject(sessionId); absent when the session cannot be resolved. */
  readonly sendPrompt?: (text: string) => Promise<void>
}

function Pending({ label }: { label: string }) {
  return <div className="dsd-card dsd-pending"><span className="dsd-spinner" />{label}</div>
}

function Failure({ title, message }: { title: string; message: string }) {
  return (
    <div className="dsd-card dsd-error">
      <div className="dsd-title">{title}</div>
      <div className="dsd-muted">{message}</div>
    </div>
  )
}

function ScopeBadge({ scope }: { scope: string }) {
  return <span className={`dsd-badge ${scope === 'chung' ? 'dsd-badge-public' : 'dsd-badge-private'}`}>{scope === 'chung' ? 'Tài liệu chung' : 'Cá nhân'}</span>
}

export function EvidenceCard({ block }: CardProps) {
  const call = readCall(block, isAnswerMeta)
  if (!call.settled) return <Pending label="Đang kiểm chứng trích dẫn…" />
  if (call.error !== undefined) return <Failure title="Trích dẫn bị từ chối, trợ lý đang thử lại" message={call.error} />
  if (call.meta === undefined) return <Failure title="Thẻ bằng chứng" message="Không đọc được dữ liệu thẻ." />
  const { answer, evidence } = call.meta
  return (
    <div className="dsd-card dsd-evidence">
      <div className="dsd-head">
        <span className="dsd-icon">✔</span>
        <span className="dsd-title">Trả lời có bằng chứng</span>
        <span className="dsd-muted">{evidence.length} trích dẫn đã xác minh</span>
      </div>
      <div className="dsd-answer">{answer}</div>
      <ol className="dsd-sources">
        {evidence.map((e, i) => (
          <li key={i} className="dsd-source">
            <div className="dsd-source-head">
              <ScopeBadge scope={e.scope} />
              <span className="dsd-file">{e.filename}</span>
              <span className="dsd-muted">· {e.locator}</span>
            </div>
            <blockquote className="dsd-quote">“{e.quote}”</blockquote>
          </li>
        ))}
      </ol>
    </div>
  )
}

export function SearchRow({ block }: CardProps) {
  const call = readCall(block, isSearchMeta)
  const [open, setOpen] = useState(false)
  const query = str(call.args.query)
  if (!call.settled) return <Pending label={`Đang tra cứu: ${query}`} />
  if (call.error !== undefined) return <Failure title="Tra cứu thất bại" message={call.error} />
  const hits = call.meta?.hits ?? []
  const top = hits.reduce((m, h) => Math.max(m, h.similarity), 0)
  return (
    <div className="dsd-row">
      <button type="button" className="dsd-row-toggle" onClick={() => setOpen(v => !v)} disabled={hits.length === 0}>
        <span className="dsd-icon">🔎</span>
        <span>Tra cứu “{query}”</span>
        <span className="dsd-muted">{hits.length === 0 ? 'không có đoạn phù hợp' : `${hits.length} đoạn · cao nhất ${top.toFixed(2)}`}</span>
        {hits.length > 0 && <span className="dsd-muted">{open ? '▾' : '▸'}</span>}
      </button>
      {open && (
        <ul className="dsd-hitlist">
          {hits.map(h => (
            <li key={h.chunkId}><ScopeBadge scope={h.scope} /> <span className="dsd-file">{h.filename}</span> <span className="dsd-muted">· {h.locator} · {h.similarity.toFixed(2)}</span></li>
          ))}
        </ul>
      )}
    </div>
  )
}

function StatusPill({ ticket }: { ticket: TicketView }) {
  return <span className={`dsd-pill dsd-pill-${ticket.status}`}>{ticket.statusLabel}</span>
}

function ProgressButton({ code, sendPrompt }: { code: string; sendPrompt: CardProps['sendPrompt'] }) {
  const [state, setState] = useState<'idle' | 'sent' | 'copied' | 'failed'>('idle')
  const text = `Kiểm tra phiếu ${code}`
  const onClick = async () => {
    try {
      if (sendPrompt !== undefined) {
        await sendPrompt(text)
        setState('sent')
        return
      }
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
  }
  const label = { idle: 'Xem tiến độ', sent: 'Đã gửi yêu cầu', copied: `Đã chép “${text}”`, failed: `Hãy gõ: ${text}` }[state]
  return <button type="button" className="dsd-button" onClick={() => void onClick()} disabled={state === 'sent'}>{label}</button>
}

export function TicketCard({ block, toolName, sendPrompt }: CardProps) {
  const call = readCall(block, isTicketMeta)
  const creating = toolName === 'create_support_ticket'
  if (!call.settled) return <Pending label={creating ? 'Đang tạo phiếu hỗ trợ…' : 'Đang kiểm tra phiếu…'} />
  if (call.error !== undefined) return <Failure title={creating ? 'Không tạo được phiếu hỗ trợ' : 'Không kiểm tra được phiếu'} message={call.error} />
  const meta = call.meta
  if (meta === undefined) return <Failure title="Phiếu hỗ trợ" message="Không đọc được dữ liệu thẻ." />
  if (!('ticket' in meta)) return <Failure title={`Không tìm thấy phiếu ${meta.code}`} message="Phiếu không tồn tại hoặc không thuộc về bạn." />
  const t = meta.ticket
  return (
    <div className="dsd-card dsd-ticket">
      <div className="dsd-head">
        <span className="dsd-icon">🎫</span>
        <span className="dsd-title">Phiếu hỗ trợ #{t.code}</span>
        <StatusPill ticket={t} />
      </div>
      <div className="dsd-field"><span className="dsd-muted">Câu hỏi:</span> {t.question}</div>
      {t.adminReply !== null
        ? (
          <div className={`dsd-reply${t.status === 'rejected' ? ' dsd-reply-rejected' : ''}`}>
            <span className="dsd-muted">{t.status === 'rejected' ? 'Lý do từ chối:' : 'Phản hồi của cán bộ:'}</span> {t.adminReply}
          </div>
        )
        : <div className="dsd-muted">Cán bộ chuyên trách sẽ phản hồi. Tạo lúc {formatTime(t.createdAt)}.</div>}
      {t.status !== 'resolved' && t.status !== 'rejected' && <div className="dsd-actions"><ProgressButton code={t.code} sendPrompt={sendPrompt} /></div>}
    </div>
  )
}

export function TicketTable({ block }: CardProps) {
  const call = readCall(block, isTicketListMeta)
  if (!call.settled) return <Pending label="Đang tải danh sách phiếu…" />
  if (call.error !== undefined || call.meta === undefined) return <Failure title="Bảng phiếu hỗ trợ" message={call.error ?? 'Không đọc được dữ liệu.'} />
  const { tickets } = call.meta
  return (
    <div className="dsd-card">
      <div className="dsd-head"><span className="dsd-icon">📋</span><span className="dsd-title">Bảng phiếu hỗ trợ</span><span className="dsd-muted">{tickets.length} phiếu</span></div>
      {tickets.length === 0 ? <div className="dsd-muted">Không có phiếu nào.</div> : (
        <table className="dsd-table">
          <thead><tr><th>Mã</th><th>Người gửi</th><th>Câu hỏi</th><th>Trạng thái</th><th>Phản hồi</th></tr></thead>
          <tbody>
            {tickets.map(t => (
              <tr key={t.code}>
                <td className="dsd-file">{t.code}</td><td>{t.userId}</td><td>{t.question}</td>
                <td><StatusPill ticket={t} /></td><td className="dsd-muted">{t.adminReply ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

export function UpdatedTicket({ block }: CardProps) {
  const call = readCall(block, isTicketMeta)
  if (!call.settled) return <Pending label="Đang cập nhật phiếu…" />
  if (call.error !== undefined || call.meta === undefined || !('ticket' in call.meta)) {
    return <Failure title="Không cập nhật được phiếu" message={call.error ?? 'Không đọc được dữ liệu.'} />
  }
  const t = call.meta.ticket
  return (
    <div className="dsd-row dsd-row-static">
      <span className="dsd-icon">✎</span><span>Đã cập nhật #{t.code}</span><StatusPill ticket={t} />
      {t.adminReply !== null && <span className="dsd-muted">“{t.adminReply}”</span>}
    </div>
  )
}

export function DocList({ block }: CardProps) {
  const call = readCall(block, isDocListMeta)
  if (!call.settled) return <Pending label="Đang tải danh sách tài liệu…" />
  if (call.error !== undefined || call.meta === undefined) return <Failure title="Tài liệu" message={call.error ?? 'Không đọc được dữ liệu.'} />
  const { documents } = call.meta
  return (
    <div className="dsd-card">
      <div className="dsd-head"><span className="dsd-icon">📚</span><span className="dsd-title">Tài liệu tra cứu được</span><span className="dsd-muted">{documents.length} tài liệu</span></div>
      {documents.length === 0 ? <div className="dsd-muted">Chưa có tài liệu nào. Gửi kèm file PDF, TXT hoặc MD để nạp.</div> : (
        <table className="dsd-table">
          <thead><tr><th>Tên file</th><th>Phạm vi</th><th>Trạng thái</th><th>Số đoạn</th><th>Khóa</th></tr></thead>
          <tbody>
            {documents.map(d => (
              <tr key={`${d.scope}/${d.docKey}`}>
                <td className="dsd-file">{d.filename}</td><td><ScopeBadge scope={d.scope} /></td>
                <td className={d.status === 'lỗi' ? 'dsd-bad' : d.status === 'đang nạp' ? 'dsd-busy' : ''} title={d.error}>
                  {d.status === 'đang nạp' && <span className="dsd-spinner" />}
                  {d.status}{d.progress ? ` · ${d.progress}` : ''}{d.error ? ` — ${d.error}` : ''}
                </td>
                <td>{d.chunks || '—'}</td><td className="dsd-muted">{d.docKey}{d.version > 0 ? ` · v${d.version}` : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function ingestText(r: IngestView): string {
  if (r.status === 'indexed') return `đã nạp phiên bản ${r.version ?? '?'} (${r.chunks ?? 0} đoạn)`
  if (r.status === 'unchanged') return 'nội dung không đổi'
  if (r.status === 'failed') return `nạp thất bại: ${r.error ?? ''}`
  return r.status
}

export function PublishCard({ block, toolName }: CardProps) {
  const publishing = toolName === 'publish_public_doc'
  const call = readCall(block, (v): v is unknown => (publishing ? isPublishMeta(v) : isReindexMeta(v)))
  if (!call.settled) return <Pending label={publishing ? 'Đang công bố tài liệu chung…' : 'Đang nạp lại tài liệu…'} />
  if (call.error !== undefined || call.meta === undefined) return <Failure title={publishing ? 'Không công bố được' : 'Không nạp lại được'} message={call.error ?? 'Không đọc được dữ liệu.'} />
  if (publishing && isPublishMeta(call.meta)) {
    const m = call.meta
    return (
      <div className="dsd-card dsd-evidence">
        <div className="dsd-head"><span className="dsd-icon">📢</span><span className="dsd-title">Đã công bố “{m.docKey}”</span></div>
        <div className="dsd-field"><span className="dsd-file">{m.filename}</span> — {ingestText(m.result)}</div>
        {m.retired.length > 0 && <div className="dsd-muted">Đã thay thế, ngừng tra cứu: {m.retired.join(', ')}</div>}
      </div>
    )
  }
  const m = call.meta as { docKey: string; result: IngestView }
  return <div className="dsd-row dsd-row-static"><span className="dsd-icon">↻</span><span>Nạp lại “{m.docKey}”</span><span className="dsd-muted">{ingestText(m.result)}</span></div>
}
