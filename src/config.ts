import path from 'node:path'

/** Host row configuration (`cordis.yml` → `docshield-core.config`). */
export interface CoreConfig {
  /** Absolute storage root holding `users/<u>`, `admin`, `public_docs`, `.docshield`. */
  readonly storageRoot: string
  /** Coarse cosine floor for search candidates (bge-m3). Default 0.45. */
  readonly minSimilarity: number
  /** Default number of passages returned by scoped_doc_search. Default 5. */
  readonly topK: number
}

export const DEFAULT_MIN_SIMILARITY = 0.45
export const DEFAULT_TOP_K = 5

/** Preset row configuration (`agent.cordis.yml` → `docshield-tools.config`). */
export interface ToolsConfig {
  readonly role: 'user' | 'admin'
}

/**
 * Validate the host row configuration. `DOCSHIELD_STORAGE_ROOT` overrides the
 * file value so a deployment can move storage without editing the bundle.
 * @throws when no absolute storage root is available.
 */
export function resolveCoreConfig(raw: unknown, env: NodeJS.ProcessEnv = process.env): CoreConfig {
  const fromFile = isRecord(raw) && typeof raw.storageRoot === 'string' ? raw.storageRoot : undefined
  const storageRoot = env.DOCSHIELD_STORAGE_ROOT?.trim() || fromFile
  if (storageRoot === undefined || storageRoot === '' || !path.isAbsolute(storageRoot)) {
    throw new Error('docshield: config.storageRoot must be an absolute path')
  }
  const minSimilarity = isRecord(raw) && typeof raw.minSimilarity === 'number' ? raw.minSimilarity : DEFAULT_MIN_SIMILARITY
  const topK = isRecord(raw) && typeof raw.topK === 'number' ? raw.topK : DEFAULT_TOP_K
  if (!(minSimilarity >= 0 && minSimilarity < 1)) throw new Error('docshield: config.minSimilarity must be in [0, 1)')
  if (!Number.isInteger(topK) || topK < 1 || topK > 8) throw new Error('docshield: config.topK must be an integer in 1..8')
  return { storageRoot: path.resolve(storageRoot), minSimilarity, topK }
}

/** @throws when `role` is missing or unknown, so a broken preset fails loudly at mount. */
export function resolveToolsConfig(raw: unknown): ToolsConfig {
  const role = isRecord(raw) ? raw.role : undefined
  if (role !== 'user' && role !== 'admin') {
    throw new Error(`docshield-tools: config.role must be "user" or "admin" (got ${JSON.stringify(role)})`)
  }
  return { role }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
