/**
 * Identity by workspace: dsh-passwords only lets a subuser open sessions whose
 * cwd lies in that subuser's allowed folder, so the session cwd is the trusted
 * identity carrier.
 *
 *   <storageRoot>/users/<u>[/...]  → user <u>
 *   <storageRoot>/admin[/...]      → admin (only the owner is granted this folder)
 *   anything else under the root   → inside, but no valid scope (deny)
 *   outside the root               → not a DocShield session
 */
import { realpathSync } from 'node:fs'
import path from 'node:path'

/** Same character set dsh-passwords accepts for usernames, lower-cased by provisioning. */
export const USER_ID_PATTERN = /^[a-z0-9_-]{3,32}$/

export type DocScope =
  | { readonly role: 'user'; readonly userId: string }
  | { readonly role: 'admin' }

export interface ScopeResolution {
  /** The cwd lies under the storage root. */
  readonly inside: boolean
  /** Valid DocShield scope, or `null` when outside or malformed. */
  readonly scope: DocScope | null
}

export interface ScopeOptions {
  readonly platform?: NodeJS.Platform
  /** Resolves symlinks/junctions; defaults to `realpathSync.native`, falling back to the input. */
  readonly realpath?: (p: string) => string
}

const OUTSIDE: ScopeResolution = { inside: false, scope: null }
const INVALID: ScopeResolution = { inside: true, scope: null }

export function resolveScope(
  cwd: string | undefined,
  storageRoot: string,
  options: ScopeOptions = {},
): ScopeResolution {
  if (cwd === undefined || cwd === '') return OUTSIDE
  const p = (options.platform ?? process.platform) === 'win32' ? path.win32 : path.posix
  const real = options.realpath ?? defaultRealpath
  const root = p.resolve(real(storageRoot))
  const target = p.resolve(real(cwd))
  // path.win32.relative compares case-insensitively, matching NTFS semantics.
  const rel = p.relative(root, target)
  if (rel === '') return INVALID
  if (rel === '..' || rel.startsWith(`..${p.sep}`) || p.isAbsolute(rel)) return OUTSIDE

  const [area, owner] = rel.split(p.sep)
  if (area === undefined) return INVALID
  const areaKey = area.toLowerCase()
  if (areaKey === 'admin') return { inside: true, scope: { role: 'admin' } }
  if (areaKey === 'users' && owner !== undefined && USER_ID_PATTERN.test(owner)) {
    return { inside: true, scope: { role: 'user', userId: owner } }
  }
  return INVALID
}

/** Search partitions a scope may read: users see public plus their own; admin sees public. */
export function readableScopes(scope: DocScope): string[] {
  return scope.role === 'user' ? ['public', `user:${scope.userId}`] : ['public']
}

function defaultRealpath(p: string): string {
  try {
    return realpathSync.native(p)
  } catch {
    return p
  }
}
