/**
 * DocShield inside a per-user container (docker mode): no database, no
 * watcher, no storage beyond the user's own folder. Tool calls and chat
 * uploads go to the host DocShield service, which decides the scope from the
 * gate-issued token.
 *
 * Uses node:http rather than fetch: indexing a long PDF can keep an upload
 * request open for minutes, past fetch's default header timeout.
 */
import http from 'node:http'
import type { DocShieldBackend } from '../dsh-types.js'
import type { IngestedUpload } from '../ingest/attachments.js'
import type { DocScope, ScopeOptions } from '../scope.js'
import { ArgumentError } from '../tools/args.js'
import type { DocInvoke } from '../tools/calls.js'

export class RemoteDocShield implements DocShieldBackend {
  readonly scopeOptions: ScopeOptions
  readonly invoke: DocInvoke

  constructor(
    readonly storageRoot: string,
    identity: DocScope,
    private readonly serviceUrl: string,
    private readonly token: string,
    readonly log: (message: string) => void = message => console.log(`[docshield] ${message}`),
  ) {
    this.scopeOptions = { identity }
    // The scope is enforced by the service from the token; only name, args and session travel.
    this.invoke = async (name, args, call) => {
      const body = await this.request('POST', '/v1/call', Buffer.from(JSON.stringify({ name, args, sessionId: call.sessionId })), 'application/json')
      return (body as { value: unknown }).value
    }
  }

  /** Send one attached file; resolves once the service has stored and indexed it (or rejected it). */
  async upload(filename: string, bytes: Buffer): Promise<IngestedUpload> {
    const body = await this.request('POST', `/v1/upload?filename=${encodeURIComponent(filename)}`, bytes, 'application/octet-stream')
    return (body ?? { filename, result: { status: 'rejected', error: 'Dịch vụ DocShield không trả kết quả.' } }) as IngestedUpload
  }

  private request(method: string, pathname: string, payload: Buffer, contentType: string): Promise<unknown> {
    const url = new URL(pathname, this.serviceUrl)
    return new Promise((resolve, reject) => {
      const req = http.request(url, {
        method,
        headers: { authorization: `Bearer ${this.token}`, 'content-type': contentType, 'content-length': payload.length },
      }, res => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8')
          let body: { error?: string; kind?: string } | undefined
          try { body = text === '' ? undefined : JSON.parse(text) } catch { body = { error: text } }
          const status = res.statusCode ?? 500
          if (status < 300) return resolve(body)
          const message = body?.error ?? `DocShield service: HTTP ${status}`
          reject(body?.kind === 'argument' ? new ArgumentError(message) : new Error(message))
        })
      })
      req.on('error', error => reject(new Error(`Không kết nối được dịch vụ DocShield (${error.message}).`)))
      req.end(payload)
    })
  }
}
