/** Password hashing with scrypt (node:crypto). Stored as `scrypt$N$r$p$salt$hash`, base64url. */
import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'

const N = 16384
const R = 8
const P = 1
const KEY_LEN = 64
export const MIN_PASSWORD_LENGTH = 8

const derive = (password, salt, n, r, p) => new Promise((resolve, reject) => {
  scrypt(password.normalize('NFC'), salt, KEY_LEN, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (err, key) => err ? reject(err) : resolve(key))
})

export async function hashPassword(password) {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`Mật khẩu cần ít nhất ${MIN_PASSWORD_LENGTH} ký tự.`)
  }
  const salt = randomBytes(16)
  const key = await derive(password, salt, N, R, P)
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64url')}$${key.toString('base64url')}`
}

export async function verifyPassword(password, stored) {
  const parts = typeof stored === 'string' ? stored.split('$') : []
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false
  const [, n, r, p, salt, hash] = parts
  const expected = Buffer.from(hash, 'base64url')
  const actual = await derive(String(password), Buffer.from(salt, 'base64url'), Number(n), Number(r), Number(p))
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

/** Hash used when the username does not exist, so a miss costs the same time as a wrong password. */
let dummy
export async function dummyVerify(password) {
  dummy ??= await hashPassword('dummy-password-for-timing')
  await verifyPassword(password, dummy)
  return false
}
