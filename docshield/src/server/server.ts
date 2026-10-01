/**
 * Host DocShield service (docker mode): the only process that opens the
 * database and the storage tree. Per-user DSH containers reach it through
 * `host.docker.internal` and act only through tool calls and uploads.
 *
 * Who is calling comes from a bearer token the gate registers for each
 * container it starts (and revokes when it stops): never from anything the
 * container sends. Token registration needs the admin key, which only the
 * gate has.
 *
 *   PUT    /v1/tokens   {token, scope}          admin key → 204
 *   DELETE /v1/tokens   {token}                 admin key → 204
 *   POST   /v1/call     {name, args, sessionId} bearer    → {value} | {error, kind}
 *   POST   /v1/upload?filename=…  raw bytes     bearer    → {filename, result}
 *   GET    /health
 */
import { randomUUID, timingSafeEqual } from 'node:crypto'
import { rm, writeFile } from 'node:fs/promises'
import http from 'node:http'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { ingestUploads, type IngestedUpload } from '../ingest/attachments.js'
import { MAX_DOCUMENT_BYTES } from '../ingest/sanitize.js'
import { USER_ID_PATTERN, type DocScope } from '../scope.js'
import type { DocShieldService } from '../service.js'
import { ArgumentError } from '../tools/args.js'

export interface ServerOptions {
  /** Shared with the gate; required to register or revoke tokens. */
  readonly adminKey: string
  readonly log?: (message: string) => void
}

const MAX_JSON = 1024 * 1024
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{32,128}$/

class HttpError extends Error {
  constructor(readonly status: number, message: string, readonly kind?: string) {
    super(message)
  }
}

export function createDocShieldServer(service: DocShieldService, options: ServerOptions): http.Server {
  if (options.adminKey.length < 32) throw new Error('docshield server: admin key must be at least 32 characters')
  const log = options.log ?? service.log
  const tokens = new Map<string, DocScope>()

  const scopeOf = (req: http.IncomingMessage): DocScope => {
    const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(req.headers.authorization ?? '')
    const scope = match === null ? undefined : tokens.get(match[1]!)
    if (scope === undefined) throw new HttpError(401, 'DocShield: token không hợp lệ hoặc đã hết hạn.')
    return scope
  }
  const requireAdmin = (req: http.IncomingMessage): void => {
    const given = Buffer.from(String(req.headers['x-docshield-admin'] ?? ''))
    const expected = Buffer.from(options.adminKey)
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new HttpError(403, 'forbidden')
  }

  const routes: Record<string, (req: http.IncomingMessage, url: URL) => Promise<unknown>> = {
    'PUT /v1/tokens': async (req) => {
      requireAdmin(req)
      const { token, scope } = await readJson(req) as { token?: unknown; scope?: unknown }
      if (typeof token !== 'string' || !TOKEN_PATTERN.test(token)) throw new HttpError(400, 'invalid token')
      const parsed = parseScope(scope)
      tokens.set(token, parsed)
      log(`token registered for ${parsed.role === 'admin' ? 'admin' : parsed.userId}`)
      return undefined
    },
    'DELETE /v1/tokens': async (req) => {
      requireAdmin(req)
      const { token } = await readJson(req) as { token?: unknown }
      if (typeof token === 'string') tokens.delete(token)
      return undefined
    },
    'POST /v1/call': async (req) => {
      const scope = scopeOf(req)
      const { name, args, sessionId } = await readJson(req) as { name?: unknown; args?: unknown; sessionId?: unknown }
      if (typeof name !== 'string') throw new HttpError(400, 'missing tool name')
      // Ledger keys are namespaced by the token's owner, so one user can never cite another's search hits.
      const session = `${ownerKey(scope)}:${typeof sessionId === 'string' ? sessionId.slice(0, 200) : 'unknown'}`
      return { value: await service.invoke(name, (args ?? {}) as Record<string, unknown>, { scope, sessionId: session }) }
    },
    'POST /v1/upload': async (req, url) => {
      const scope = scopeOf(req)
      const filename = url.searchParams.get('filename') ?? ''
      const bytes = await readBody(req, MAX_DOCUMENT_BYTES)
      const temp = path.join(tmpdir(), `docshield-upload-${randomUUID()}`)
      await writeFile(temp, bytes)
      try {
        const [upload] = await ingestUploads(
          { id: 'upload', header: {} },
          [{ attachmentId: 'upload', name: filename, bytes: bytes.length }],
          { storageRoot: service.storageRoot, attachments: { fileHostPath: () => temp }, indexer: service.indexer, resolve: service.resolve, scopeOptions: { identity: scope } },
        )
        return upload satisfies IngestedUpload | undefined
      } finally {
        await rm(temp, { force: true })
      }
    },
  }

  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://docshield')
    const reply = (status: number, body?: unknown) => {
      if (res.headersSent) return
      if (body === undefined) { res.writeHead(status).end(); return }
      res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body))
    }
    if (req.method === 'GET' && url.pathname === '/health') return reply(200, { ok: true, tokens: tokens.size })
    const route = routes[`${req.method} ${url.pathname}`]
    if (route === undefined) return reply(404, { error: 'not found' })
    route(req, url).then(
      value => reply(value === undefined ? 204 : 200, value),
      (error: unknown) => {
        if (error instanceof HttpError) return reply(error.status, { error: error.message, ...(error.kind ? { kind: error.kind } : {}) })
        if (error instanceof ArgumentError) return reply(400, { error: error.message, kind: 'argument' })
        const message = error instanceof Error ? error.message : String(error)
        log(`${req.method} ${url.pathname} failed: ${message}`)
        reply(500, { error: message })
      },
    )
  })
}

const ownerKey = (scope: DocScope) => (scope.role === 'admin' ? 'admin' : `user:${scope.userId}`)

function parseScope(raw: unknown): DocScope {
  const s = raw as { role?: unknown; userId?: unknown } | null
  if (s?.role === 'admin') return { role: 'admin' }
  if (s?.role === 'user' && typeof s.userId === 'string' && USER_ID_PATTERN.test(s.userId)) return { role: 'user', userId: s.userId }
  throw new HttpError(400, 'invalid scope')
}

function readBody(req: http.IncomingMessage, max: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > max) {
        reject(new HttpError(413, `Tệp vượt quá ${Math.round(max / 1024 / 1024)} MB.`, 'argument'))
        req.destroy()
      } else chunks.push(chunk)
    })
    req.on('end', () => resolve(Buffer.concat(chunks)))
    req.on('error', reject)
  })
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  try {
    return JSON.parse((await readBody(req, MAX_JSON)).toString('utf8'))
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'invalid JSON')
  }
}
