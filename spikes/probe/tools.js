// M0 probe, preset row: restrict globals, register probe_echo, report what the agent can see.
import { log } from './log.js'

export const name = 'docshield-probe-tools'
export const inject = ['tools']

function scopeKeyOf(c) {
  for (let o = c; o; o = Object.getPrototypeOf(o)) {
    for (const s of Object.getOwnPropertySymbols(o)) if (s.description === 'dsh.scope') return c[s]
  }
  return undefined
}

export function apply(ctx) {
  let restricted = 'not attempted'
  try {
    if (process.env.PROBE_RESTRICT === '1') { ctx.effect(() => ctx.tools.restrict({ allow: [] }), 'docshield-probe: restrict'); restricted = 'ok' } else restricted = 'skipped'
  } catch (e) { restricted = 'ERR ' + e.message }
  log('preset-row', { restricted, visibleAtRow: ctx.tools.schemas(scopeKeyOf(ctx)).map(s => s.name) })
  ctx.effect(() => ctx.tools.register({
    name: 'probe_echo',
    description: 'Diagnostic tool. Call it once when the user says "probe".',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: { schema: { type: 'object' }, render: (_a, v) => [{ type: 'text', text: JSON.stringify(v) }] },
    async execute(_args, exec) {
      const scope = exec.agent ? scopeKeyOf(exec.agent.ctx) : undefined
      const visible = ctx.tools.schemas(scope).map(s => s.name)
      const globalView = ctx.tools.schemas().map(s => s.name)
      const value = { cwd: exec.agent?.session?.header?.cwd, sessionId: exec.agent?.session?.id, restricted, visible, globalCount: globalView.length }
      log('probe_echo', value)
      return value
    },
  }), 'docshield-probe: probe_echo')
  log('preset-row-after-register', { visibleAtRow: ctx.tools.schemas(scopeKeyOf(ctx)).map(s => s.name), global: ctx.tools.schemas().map(s => s.name) })
}
