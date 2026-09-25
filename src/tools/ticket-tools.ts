/** Bodies and model-facing renderers for the ticket tools (user and admin). */
import { TICKET_STATUS_LABEL, TicketError, type TicketStatus, type TicketView } from '../db/tickets.js'
import type { DocScope } from '../scope.js'
import type { DocShieldService } from '../service.js'
import { ArgumentError, requireString } from './args.js'
import type { ToolBody } from './defs.js'
import { requireScope } from './scope-check.js'

const STATUSES = Object.keys(TICKET_STATUS_LABEL) as TicketStatus[]

/** Ticket owner id for a scope: the user id, or 'admin' for the admin workspace. */
const ownerOf = (scope: DocScope) => (scope.role === 'user' ? scope.userId : 'admin')

function optionalStatus(args: Record<string, unknown>, key: string): TicketStatus | undefined {
  const value = args[key]
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || !STATUSES.includes(value as TicketStatus)) {
    throw new ArgumentError(`"${key}" phải là một trong: ${STATUSES.join(', ')}.`)
  }
  return value as TicketStatus
}

export function createTicketBody(service: DocShieldService): ToolBody {
  return async (args, exec) => {
    const scope = requireScope(exec, service, 'any')
    const question = requireString(args, 'question', { max: 2000 })
    const reason = requireString(args, 'reason', { max: 1000 })
    return service.tickets.create({ userId: ownerOf(scope), sessionId: exec.agent?.session.id ?? 'unknown', question, reason })
  }
}

export function renderCreateTicket(value: unknown): string {
  const { ticket, reused } = value as { ticket: TicketView; reused: boolean }
  return `${reused ? 'Phiếu cho câu hỏi này đã tồn tại' : 'Đã tạo phiếu hỗ trợ'} ${ticket.code} (${ticket.statusLabel}). Báo cho người dùng mã phiếu ${ticket.code} và rằng cán bộ sẽ phản hồi; họ có thể hỏi lại "kiểm tra phiếu ${ticket.code}".`
}

export function checkTicketBody(service: DocShieldService): ToolBody {
  return async (args, exec) => {
    const scope = requireScope(exec, service, 'any')
    const code = requireString(args, 'code', { max: 20 })
    // Users only ever see their own tickets; a foreign code looks exactly like a missing one.
    const ticket = service.tickets.get(code, scope.role === 'admin' ? undefined : scope.userId)
    return ticket === undefined ? { found: false, code } : { found: true, ticket }
  }
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

export function listTicketsBody(service: DocShieldService): ToolBody {
  return async (args, exec) => {
    requireScope(exec, service, 'admin')
    const status = optionalStatus(args, 'status')
    const tickets = service.tickets.list(status === undefined ? {} : { status })
    return { count: tickets.length, tickets }
  }
}

export function renderListTickets(value: unknown): string {
  const { count, tickets } = value as { count: number; tickets: TicketView[] }
  if (count === 0) return 'Không có phiếu nào.'
  return [`${count} phiếu:`, ...tickets.map(t =>
    `- ${t.code} [${t.statusLabel}] người gửi ${t.userId}: "${t.question}"${t.adminReply ? ` — đã phản hồi: "${t.adminReply}"` : ''}`)].join('\n')
}

export function updateTicketBody(service: DocShieldService): ToolBody {
  return async (args, exec) => {
    requireScope(exec, service, 'admin')
    const code = requireString(args, 'code', { max: 20 })
    const status = optionalStatus(args, 'status')
    if (status === undefined) throw new ArgumentError('Thiếu "status".')
    const reply = args.reply === undefined || args.reply === null ? undefined : requireString(args, 'reply', { max: 2000 })
    try {
      return { ticket: service.tickets.update(code, status, reply) }
    } catch (error) {
      if (error instanceof TicketError) throw new ArgumentError(error.message)
      throw error
    }
  }
}

export function renderUpdateTicket(value: unknown): string {
  const { ticket } = value as { ticket: TicketView }
  return `Đã cập nhật ${ticket.code}: ${ticket.statusLabel}${ticket.adminReply ? `, phản hồi: "${ticket.adminReply}"` : ''}.`
}
