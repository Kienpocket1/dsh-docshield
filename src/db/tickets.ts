/**
 * Support tickets. Every write is one IMMEDIATE transaction, so concurrent
 * creators across sessions (and processes) serialise on the database lock and
 * each gets its own AUTOINCREMENT id (TC-06). A repeated create for the same
 * open question within DEDUPE_MINUTES returns the existing ticket, because
 * models sometimes call the tool twice in one turn.
 */
import type { DatabaseSync } from 'node:sqlite'
import { transaction } from './database.js'

export type TicketStatus = 'open' | 'in_progress' | 'resolved' | 'rejected'

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open: 'Đang chờ xử lý',
  in_progress: 'Đang xử lý',
  resolved: 'Đã giải quyết',
  rejected: 'Từ chối',
}

const DEDUPE_MINUTES = 10
export const MAX_TICKETS_PER_HOUR = 10

export interface TicketRow {
  readonly id: number
  readonly user_id: string
  readonly session_id: string
  readonly question: string
  readonly reason: string
  readonly status: TicketStatus
  readonly admin_reply: string | null
  readonly created_at: string
  readonly updated_at: string
}

export interface TicketView {
  readonly code: string
  readonly userId: string
  readonly question: string
  readonly reason: string
  readonly status: TicketStatus
  readonly statusLabel: string
  readonly adminReply: string | null
  readonly createdAt: string
  readonly updatedAt: string
}

export class TicketError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TicketError'
  }
}

export const ticketCode = (id: number) => `TICK-${id}`

/** Accepts "TICK-101", "tick 101", "TICK - 101", "#TICK-101". */
export function parseTicketCode(code: string): number | undefined {
  const match = /^#?\s*TICK\s*-?\s*(\d{1,9})$/i.exec(code.trim())
  return match ? Number(match[1]) : undefined
}

export function toView(row: TicketRow): TicketView {
  return {
    code: ticketCode(row.id),
    userId: row.user_id,
    question: row.question,
    reason: row.reason,
    status: row.status,
    statusLabel: TICKET_STATUS_LABEL[row.status],
    adminReply: row.admin_reply,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export class TicketStore {
  constructor(private readonly db: DatabaseSync) {}

  create(input: { userId: string; sessionId: string; question: string; reason: string }): { ticket: TicketView; reused: boolean } {
    return transaction(this.db, () => {
      const duplicate = this.db.prepare(`
        SELECT * FROM tickets
        WHERE user_id = ? AND question = ? AND status NOT IN ('resolved', 'rejected')
          AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?)
        ORDER BY id DESC LIMIT 1`).get(input.userId, input.question, `-${DEDUPE_MINUTES} minutes`) as TicketRow | undefined
      if (duplicate !== undefined) return { ticket: toView(duplicate), reused: true }

      const { n } = this.db.prepare(`
        SELECT COUNT(*) AS n FROM tickets
        WHERE user_id = ? AND created_at >= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-1 hour')`).get(input.userId) as { n: number }
      if (n >= MAX_TICKETS_PER_HOUR) {
        throw new TicketError(`Bạn đã tạo ${n} phiếu trong 1 giờ qua (tối đa ${MAX_TICKETS_PER_HOUR}). Vui lòng chờ cán bộ xử lý.`)
      }
      const row = this.db.prepare(`
        INSERT INTO tickets (user_id, session_id, question, reason) VALUES (?, ?, ?, ?)
        RETURNING *`).get(input.userId, input.sessionId, input.question, input.reason) as unknown as TicketRow
      return { ticket: toView(row), reused: false }
    })
  }

  /** A user sees only their own tickets; `userId === undefined` means admin (all). */
  get(code: string, userId: string | undefined): TicketView | undefined {
    const id = parseTicketCode(code)
    if (id === undefined) return undefined
    const row = this.db.prepare('SELECT * FROM tickets WHERE id = ?').get(id) as TicketRow | undefined
    if (row === undefined || (userId !== undefined && row.user_id !== userId)) return undefined
    return toView(row)
  }

  list(filter: { status?: TicketStatus; userId?: string; limit?: number } = {}): TicketView[] {
    const where: string[] = []
    const params: (string | number)[] = []
    if (filter.status !== undefined) {
      where.push('status = ?')
      params.push(filter.status)
    }
    if (filter.userId !== undefined) {
      where.push('user_id = ?')
      params.push(filter.userId)
    }
    params.push(filter.limit ?? 50)
    const rows = this.db.prepare(`
      SELECT * FROM tickets ${where.length > 0 ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END, id DESC
      LIMIT ?`).all(...params) as unknown as TicketRow[]
    return rows.map(toView)
  }

  update(code: string, status: TicketStatus, reply: string | undefined): TicketView {
    const id = parseTicketCode(code)
    if (id === undefined) throw new TicketError(`Mã phiếu không hợp lệ: ${code}`)
    // A rejection must tell the asker why; an earlier reply may be about something else.
    if (status === 'rejected' && (reply ?? '').trim() === '') {
      throw new TicketError('Từ chối phiếu cần ghi lý do trong "reply" để gửi cho người hỏi.')
    }
    return transaction(this.db, () => {
      const row = this.db.prepare(`
        UPDATE tickets
        SET status = ?, admin_reply = COALESCE(?, admin_reply),
            updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? RETURNING *`).get(status, reply ?? null, id) as TicketRow | undefined
      if (row === undefined) throw new TicketError(`Không tìm thấy phiếu ${ticketCode(id)}.`)
      return toView(row)
    })
  }
}
