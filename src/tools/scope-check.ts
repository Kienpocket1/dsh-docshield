import type { ToolExecutionView } from '../dsh-types.js'
import { resolveScope, type DocScope } from '../scope.js'

/**
 * Second line of defence inside every tool: the guard already filters by
 * role, but a tool must never act without a valid scope of the role it needs.
 * @throws when the session is outside DocShield or lacks the required role.
 */
export function requireScope(
  exec: ToolExecutionView,
  storageRoot: string,
  needs: 'user' | 'admin' | 'any',
): DocScope {
  const { scope } = resolveScope(exec.agent?.session.header.cwd, storageRoot)
  if (scope === null) throw new Error('DocShield: phiên này không thuộc workspace DocShield hợp lệ.')
  if (needs !== 'any' && scope.role !== needs) {
    throw new Error(`DocShield: công cụ này chỉ dành cho vai trò ${needs === 'admin' ? 'Admin' : 'người dùng'}.`)
  }
  return scope
}
