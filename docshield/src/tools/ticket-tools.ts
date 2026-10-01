/** Model-facing renderers for the ticket tools (bodies: ./calls.ts). */
import type { TicketView } from '../db/tickets.js'

export function renderCreateTicket(value: unknown): string {
  const { ticket, reused } = value as { ticket: TicketView; reused: boolean }
  return `${reused ? 'Phiếu cho câu hỏi này đã tồn tại' : 'Đã tạo phiếu hỗ trợ'} ${ticket.code} (${ticket.statusLabel}). Báo cho người dùng mã phiếu ${ticket.code} và rằng cán bộ sẽ phản hồi; họ có thể hỏi lại "kiểm tra phiếu ${ticket.code}".`
}

export function renderCheckTicket(value: unknown): string {
  const result = value as { found: false; code: string } | { found: true; ticket: TicketView }
  if (!result.found) return `Không tìm thấy phiếu ${result.code} trong các phiếu của bạn.`
  const t = result.ticket
  const reply = t.adminReply
    ? ` ${t.status === 'rejected' ? 'Lý do từ chối' : 'Phản hồi của cán bộ'}: "${t.adminReply}".`
    : ' Chưa có phản hồi.'
  return `Phiếu ${t.code}: ${t.statusLabel}. Câu hỏi: "${t.question}".${reply}`
}

export function renderListTickets(value: unknown): string {
  const { count, tickets } = value as { count: number; tickets: TicketView[] }
  if (count === 0) return 'Không có phiếu nào.'
  return [`${count} phiếu:`, ...tickets.map(t =>
    `- ${t.code} [${t.statusLabel}] người gửi ${t.userId}: "${t.question}"${t.adminReply ? ` — đã phản hồi: "${t.adminReply}"` : ''}`)].join('\n')
}

export function renderUpdateTicket(value: unknown): string {
  const { ticket } = value as { ticket: TicketView }
  return `Đã cập nhật ${ticket.code}: ${ticket.statusLabel}${ticket.adminReply ? `, phản hồi: "${ticket.adminReply}"` : ''}.`
}
