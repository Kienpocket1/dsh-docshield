// Shared helpers for DocShield operator scripts (plain Node, no build step).
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const USER_ID_PATTERN = /^[a-z0-9_-]{3,32}$/
export const PRESET_IDS = ['docshield', 'docshield-admin']

export function dshHome() {
  return process.env.DSH_HOME?.trim() || path.join(homedir(), '.dsh')
}

/** DOCSHIELD_STORAGE_ROOT, else the storageRoot written in cordis.yml. */
export function storageRoot() {
  const fromEnv = process.env.DOCSHIELD_STORAGE_ROOT?.trim()
  if (fromEnv) return path.resolve(fromEnv)
  const yml = readFileSync(path.join(PACKAGE_ROOT, 'cordis.yml'), 'utf8')
  const match = yml.match(/^\s*storageRoot:\s*['"]?([^'"\n]+)['"]?\s*$/m)
  if (!match?.[1]) throw new Error('Không tìm thấy storageRoot trong cordis.yml; đặt DOCSHIELD_STORAGE_ROOT.')
  return path.resolve(match[1].trim())
}

/** Normalised comparison key for Windows paths (case-insensitive, forward slashes, no trailing slash). */
export function pathKey(p) {
  const resolved = path.resolve(p).replaceAll('\\', '/').replace(/\/+$/, '')
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved
}
