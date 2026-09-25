import type { ToolExecutionView } from '../dsh-types.js'
import { resolveScope, type DocScope, type ScopeOptions } from '../scope.js'

/** Where a tool resolves the caller's scope from (the `docshield` service satisfies it). */
export interface ScopeSource {
  readonly storageRoot: string
  readonly scopeOptions?: ScopeOptions
}

/**
 * Second line of defence inside every tool: the guard already filters by
 * role, but a tool must never act without a valid scope of the role it needs.
 * @throws when the session is outside DocShield or lacks the required role.
 */
export function requireScope(
  exec: ToolExecutionView,
  source: ScopeSource,
  needs: 'user' | 'admin' | 'any',
): DocScope {
  const { scope } = resolveScope(exec.agent?.session.header.cwd, source.storageRoot, source.scopeOptions)
  if (scope === null) throw new Error('DocShield: phiên này không thuộc workspace DocShield hợp lệ.')
  if (needs !== 'any' && scope.role !== needs) {
    throw new Error(`DocShield: công cụ này chỉ dành cho vai trò ${needs === 'admin' ? 'Admin' : 'người dùng'}.`)
  }
  return scope
}
