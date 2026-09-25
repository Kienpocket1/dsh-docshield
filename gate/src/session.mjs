/**
 * Signed session cookie: base64url(JSON {u, cv, exp}) + "." + HMAC-SHA256.
 * `cv` is the user's credential_version, so a password change or disable
 * revokes every outstanding cookie without a server-side session table.
 */
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'

export const SESSION_COOKIE = 'gate_session'
export const CSRF_COOKIE = 'gate_csrf'
export const SESSION_TTL_MS = 12 * 60 * 60_000

export function loadSecret(file) {
  if (!existsSync(file)) writeFileSync(file, randomBytes(32).toString('base64url'), { mode: 0o600 })
  return Buffer.from(readFileSync(file, 'utf8').trim(), 'base64url')
}

const sign = (secret, body) => createHmac('sha256', secret).update(body).digest('base64url')

export function issueSession(secret, user, now = Date.now()) {
  const body = Buffer.from(JSON.stringify({ u: user.username, cv: user.credential_version, exp: now + SESSION_TTL_MS })).toString('base64url')
  return `${body}.${sign(secret, body)}`
}

/** Returns the username when the cookie is authentic, unexpired and still matches the account. */
export function verifySession(secret, value, lookupUser, now = Date.now()) {
  if (typeof value !== 'string') return undefined
  const dot = value.indexOf('.')
  if (dot <= 0) return undefined
  const body = value.slice(0, dot)
  const given = Buffer.from(value.slice(dot + 1), 'base64url')
  const expected = Buffer.from(sign(secret, body), 'base64url')
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return undefined
  let claims
  try { claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) } catch { return undefined }
  if (typeof claims?.u !== 'string' || typeof claims.exp !== 'number' || claims.exp <= now) return undefined
  const user = lookupUser(claims.u)
  if (user === undefined || user.disabled || user.credential_version !== claims.cv) return undefined
  if (user.status !== undefined && user.status !== 'active') return undefined
  return user
}

/** CSRF token for forms of a signed-in user, bound to that session cookie (no extra cookie needed). */
export function formToken(secret, sessionValue) {
  return createHmac('sha256', secret).update(`form:${sessionValue}`).digest('base64url')
}

export function sameToken(a, b) {
  const x = Buffer.from(String(a ?? ''))
  const y = Buffer.from(String(b ?? ''))
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y)
}

export function parseCookies(header) {
  const out = {}
  for (const part of (header ?? '').split(';')) {
    const eq = part.indexOf('=')
    if (eq > 0) out[part.slice(0, eq).trim()] = decodeURIComponent(part.slice(eq + 1).trim())
  }
  return out
}

export function cookie(name, value, { maxAgeSec, httpOnly = true } = {}) {
  let c = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`
  if (httpOnly) c += '; HttpOnly'
  if (maxAgeSec !== undefined) c += `; Max-Age=${maxAgeSec}`
  return c
}

export const newCsrfToken = () => randomBytes(24).toString('base64url')
