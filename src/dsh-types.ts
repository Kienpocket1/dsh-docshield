/**
 * Minimal structural views of the DeepSeek Harness host API that DocShield uses.
 *
 * DocShield is linked into a DSH profile from outside DSH's own node_modules
 * tree, so it must not import `@deepseek-ai/*` at runtime (module-private
 * symbols such as the scope key would not match). These interfaces describe
 * only the fields we read; the live objects come from injected services.
 */
import type { ScopeOptions } from './scope.js'
import type { DocInvoke } from './tools/calls.js'

/**
 * The `docshield` service as the tool rows see it: the in-process
 * DocShieldService, or (docker mode) RemoteDocShield talking to the host service.
 */
export interface DocShieldBackend {
  readonly storageRoot: string
  readonly scopeOptions: ScopeOptions
  readonly invoke: DocInvoke
}

export interface SessionHeaderView {
  readonly cwd?: string
}

export interface SessionView {
  readonly id: string
  readonly header: SessionHeaderView
}

export interface AgentView {
  readonly session: SessionView
}

/** The immutable identity of one tool execution (`ToolExecution` in dsh-tools). */
export interface ToolExecutionView {
  readonly name: string
  readonly callId?: string
  readonly agent?: AgentView
  readonly signal?: AbortSignal
}

/** Returned reason denies the call; `undefined` lets it through. */
export type ToolGuard = (execution: Readonly<ToolExecutionView>) => string | undefined

export interface ContentBlock {
  readonly type: 'text'
  readonly text: string
}

/** Raw JSON-Schema tool definition accepted by `ctx.tools.register()`. */
export interface RawToolDefinition {
  readonly name: string
  readonly description: string
  readonly parameters: Record<string, unknown>
  readonly output: {
    readonly schema: Record<string, unknown>
    render(args: unknown, value: unknown): ContentBlock[]
    presentationMeta?(args: unknown, value: unknown): unknown
  }
  execute(args: unknown, exec: ToolExecutionView): Promise<unknown>
}

export interface ToolsService {
  register(definition: RawToolDefinition): () => void
  guard(guard: ToolGuard): () => void
}

/** A `session/event` record; DocShield reads `user/message` content parts. */
export interface SessionEventView {
  readonly type: string
  readonly data?: { readonly content?: readonly unknown[] }
}

/** The subset of a Cordis context DocShield touches. */
export interface DshContext {
  readonly tools: ToolsService
  readonly docshield: DocShieldBackend
  inject(deps: string[], callback: (ctx: DshContext) => void): void
  effect(execute: () => () => unknown, label?: string): void
  provide(name: string, value: unknown): void
  get(name: string): unknown
  on(event: 'session/event', listener: (session: SessionView, event: SessionEventView) => void): () => void
}

/** Minimal view of a live agent handle for best-effort context injection. */
export interface AgentHandleView {
  inject?(message: { content: ContentBlock[]; source: { kind: 'plugin'; plugin: string } }): unknown
}
