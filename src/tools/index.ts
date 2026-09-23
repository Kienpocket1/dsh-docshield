/**
 * Preset row (`docshield-tools`): registers the DocShield tools for one role
 * into the preset's scoped catalog. Do NOT call `tools.restrict()` here: a
 * restriction at the preset's standing scope also hides the preset's own
 * tools from joined agents (verified in M0). The preset simply contains no
 * other tools, and the host guard covers the rest.
 */
import { resolveToolsConfig } from '../config.js'
import type { DshContext } from '../dsh-types.js'
import { ADMIN_TOOLS, USER_TOOLS } from '../guard.js'
import { requireScope } from './scope-check.js'
import { defineDocTool, TOOL_SPECS, type ToolBody, type ToolRender } from './defs.js'
import { publishBody, reindexBody, renderPublish, renderReindex } from './admin-doc-tools.js'
import { answerBody, renderAnswer, renderSearch, searchBody } from './retrieval-tools.js'
import {
  checkTicketBody, createTicketBody, listTicketsBody, renderCheckTicket, renderCreateTicket,
  renderListTickets, renderUpdateTicket, updateTicketBody,
} from './ticket-tools.js'

export const name = 'docshield-tools'
export const inject = ['tools', 'docshield']

export function apply(ctx: DshContext, rawConfig?: unknown): void {
  const { role } = resolveToolsConfig(rawConfig)
  const service = ctx.docshield
  const { storageRoot } = service
  const allowed = role === 'admin' ? ADMIN_TOOLS : USER_TOOLS

  const bodies: Record<string, { body: ToolBody; render?: ToolRender }> = {
    list_documents: {
      body: async (_args, exec) => {
        const documents = service.listDocuments(requireScope(exec, storageRoot, 'any'))
        return { count: documents.length, documents }
      },
    },
    scoped_doc_search: { body: searchBody(service), render: renderSearch },
    answer_with_evidence: { body: answerBody(service), render: renderAnswer },
    create_support_ticket: { body: createTicketBody(service), render: renderCreateTicket },
    check_ticket_status: { body: checkTicketBody(service), render: renderCheckTicket },
    list_tickets: { body: listTicketsBody(service), render: renderListTickets },
    update_ticket: { body: updateTicketBody(service), render: renderUpdateTicket },
    publish_public_doc: { body: publishBody(service), render: renderPublish },
    reindex_document: { body: reindexBody(service), render: renderReindex },
  }

  for (const spec of TOOL_SPECS) {
    if (!allowed.has(spec.name)) continue
    const entry = bodies[spec.name]
    if (entry === undefined) throw new Error(`docshield-tools: no implementation for ${spec.name}`)
    const definition = defineDocTool(spec, storageRoot, entry.body, entry.render)
    ctx.effect(() => ctx.tools.register(definition), `docshield-tools: ${spec.name}`)
  }
}
