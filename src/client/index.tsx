/**
 * DocShield browser plugin: registers one `tool.call.toolview` card per
 * DocShield tool. `inject` MUST list every service used (M0: a missing
 * 'slots' makes the page report "Failed to load plugins").
 */
import { DocList, EvidenceCard, PublishCard, SearchRow, TicketCard, TicketTable, UpdatedTicket, type CardProps } from './cards.js'
import { CSS } from './styles.js'

interface SessionFaceView {
  prompt(content: { type: 'text'; text: string }[], mode: 'queue' | 'steer'): Promise<{ ok: boolean; error?: { code: string; message: string } }>
}

interface ClientContext {
  slots: {
    inject(name: string, register: () => unknown): void
    register(options: Record<string, unknown>, component: (props: CardProps) => unknown): () => void
  }
  sessions: { binding(id: string): { session: SessionFaceView } | undefined }
  effect(execute: () => () => void, label?: string): void
}

export const name = 'docshield-client'
export const inject = ['slots', 'sessions']

const CARDS: Record<string, (props: CardProps) => unknown> = {
  answer_with_evidence: EvidenceCard,
  scoped_doc_search: SearchRow,
  create_support_ticket: TicketCard,
  check_ticket_status: TicketCard,
  list_tickets: TicketTable,
  update_ticket: UpdatedTicket,
  list_documents: DocList,
  publish_public_doc: PublishCard,
  reindex_document: PublishCard,
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => {
    const style = document.createElement('style')
    style.dataset.docshield = ''
    style.textContent = CSS
    document.head.append(style)
    return () => style.remove()
  }, 'docshield: styles')

  const sendPromptFor = (sessionId: string) => async (text: string) => {
    const binding = ctx.sessions.binding(sessionId)
    if (binding === undefined) throw new Error('session not bound')
    const result = await binding.session.prompt([{ type: 'text', text }], 'queue')
    if (!result.ok) throw new Error(result.error?.message ?? 'prompt rejected')
  }

  for (const [key, component] of Object.entries(CARDS)) {
    ctx.slots.inject('tool.call.toolview', () => ctx.slots.register(
      { name: 'tool.call.toolview', key, inject: (sessionId: string) => ({ sendPrompt: sendPromptFor(sessionId) }) },
      component,
    ))
  }
}
