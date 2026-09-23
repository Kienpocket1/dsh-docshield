// M0 probe, host side: observe tool executions (cwd format) and session events (attachment shape).
import { log } from './log.js'

export const name = 'docshield-probe'

export function apply(ctx) {
  log('host', { loaded: true, services: ['tools', 'attachments', 'agentPresets'].map(s => [s, ctx.get(s) !== undefined]) })
  ctx.inject(['tools'], (toolsCtx) => {
    toolsCtx.effect(() => toolsCtx.tools.guard((exec) => {
      log('guard', { tool: exec.name, cwd: exec.agent?.session?.header?.cwd, sessionId: exec.agent?.session?.id })
      return undefined
    }), 'docshield-probe: guard')
  })
  ctx.on('agent/request', async (payload, next) => {
    const cfg = await next()
    let agentTools = 'n/a'
    try {
      const a = payload.agent
      let key
      for (let o = a?.ctx; o && key === undefined; o = Object.getPrototypeOf(o)) for (const sym of Object.getOwnPropertySymbols(o)) if (sym.description === 'dsh.scope') key = a.ctx[sym]
      const tools = a?.ctx?.get?.('tools') ?? ctx.get('tools')
      agentTools = tools ? tools.schemas(key).map(t => t.name) : 'no tools service'
    } catch (e) { agentTools = 'ERR ' + e.message }
    log('llm-request', { sessionId: payload.agent?.session?.id, preset: payload.agent?.session?.header?.agentPreset, agentTools })
    return cfg
  })
  ctx.on('llm/stream', (options, next) => {
    log('llm-stream', { purpose: options?.purpose, sessionId: options?.sessionId, provider: options?.provider, model: options?.model, tools: (options?.tools ?? []).map(t => t.name), toolChoice: options?.toolChoice })
    return next()
  })
  ctx.on('session/event', (session, event) => {
    const type = event?.type
    if (typeof type !== 'string') return
    if (type.startsWith('user') || type.includes('message') || JSON.stringify(event).includes('"file"')) {
      log('event', { sessionId: session?.id, cwd: session?.header?.cwd, type, event })
      const attachments = ctx.get('attachments')
      const walk = (node) => {
        if (node === null || typeof node !== 'object') return
        if (node.type === 'file') {
          let hostPath
          for (const candidate of [node, node.ref, node.attachment, node.source]) {
            if (candidate === undefined) continue
            try { hostPath = attachments?.fileHostPath(candidate) } catch (e) { hostPath = 'ERR ' + e.message }
            if (hostPath !== undefined) break
          }
          log('file-part', { node, hostPath })
        }
        for (const child of Object.values(node)) walk(child)
      }
      walk(event)
    }
  })
}
