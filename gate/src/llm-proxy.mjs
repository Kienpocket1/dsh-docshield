/**
 * Model proxy for docker mode (sandbox step S2): the real provider API keys
 * never enter a container. Each container's settings point its providers at
 * `http://host.docker.internal:<port>/llm/<provider>` and its `apiKeyEnv`
 * variables hold the container's own token. This proxy accepts only tokens of
 * running containers, swaps the token for the real key and streams the
 * provider's response back unchanged.
 */
import http from 'node:http'
import https from 'node:https'

/**
 * Providers declared under `llm-pi-ai.providers` in a DSH settings.yaml, as
 * written by DSH itself (two-space indentation). Only routes with both a
 * `baseURL` and an `apiKeyEnv` can be proxied.
 * @returns {{ name: string, baseURL?: string, apiKeyEnv?: string }[]}
 */
export function parseProviders(settings) {
  const providers = []
  let inBlock = false
  let inProviders = false
  let current
  for (const line of settings.split(/\r?\n/)) {
    if (/^\S/.test(line)) { inBlock = /^llm-pi-ai:\s*$/.test(line); inProviders = false; continue }
    if (!inBlock) continue
    if (/^ {2}\S/.test(line)) { inProviders = /^ {2}providers:\s*$/.test(line); continue }
    if (!inProviders) continue
    const name = /^ {4}([A-Za-z0-9_.-]+):\s*$/.exec(line)
    if (name) { current = { name: name[1] }; providers.push(current); continue }
    const field = /^ {6}(baseURL|apiKeyEnv):\s*['"]?([^'"#]+?)['"]?\s*$/.exec(line)
    if (field && current) current[field[1]] = field[2]
  }
  return providers
}

/** settings.yaml for a container: every proxied provider's baseURL replaced by its proxy route. */
export function proxiedSettings(settings, llmOrigin, names) {
  let inBlock = false
  let inProviders = false
  let current
  return settings.split(/\r?\n/).map(line => {
    if (/^\S/.test(line)) { inBlock = /^llm-pi-ai:\s*$/.test(line); inProviders = false; return line }
    if (!inBlock) return line
    if (/^ {2}\S/.test(line)) { inProviders = /^ {2}providers:\s*$/.test(line); return line }
    if (!inProviders) return line
    const name = /^ {4}([A-Za-z0-9_.-]+):\s*$/.exec(line)
    if (name) { current = name[1]; return line }
    if (current !== undefined && names.includes(current) && /^ {6}baseURL:/.test(line)) return `      baseURL: ${llmOrigin}/llm/${current}`
    return line
  }).join('\n')
}

/** `refs` values of a DSH credentials file: NAME → secret. */
export function credentialValues(text) {
  const values = new Map()
  const lines = text.split(/\r?\n/)
  for (let i = lines.indexOf('refs:') + 1; i > 0 && i < lines.length && /^\s+\S/.test(lines[i]); i++) {
    const match = /^\s+([A-Za-z_][A-Za-z0-9_]*):\s*['"]?(.*?)['"]?\s*$/.exec(lines[i])
    if (match) values.set(match[1], match[2])
  }
  return values
}

const HOP_BY_HOP = new Set(['connection', 'keep-alive', 'proxy-connection', 'transfer-encoding', 'upgrade', 'te', 'trailer', 'host'])
const KEY_HEADERS = ['authorization', 'x-api-key', 'api-key']

/**
 * @param {object} opts
 * @param {{ name: string, baseURL: string, key: string }[]} opts.providers
 * @param {(token: string) => string | undefined} opts.verify  token → account name of a running container
 * @param {(m: string) => void} [opts.log]
 */
export function createLlmProxy({ providers, verify, log = () => {} }) {
  const byName = new Map(providers.map(p => [p.name, p]))
  return http.createServer((req, res) => {
    const fail = (status, message) => {
      if (!res.headersSent) res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: { message } }))
    }
    if (req.method === 'GET' && req.url === '/health') return fail(200, 'ok')
    const route = /^\/llm\/([A-Za-z0-9_.-]+)(\/.*)?$/.exec(req.url ?? '')
    const provider = route && byName.get(route[1])
    if (!provider) return fail(404, 'unknown provider')
    // The container presents its token wherever its SDK puts an API key.
    let token
    for (const h of KEY_HEADERS) {
      const value = req.headers[h]
      if (typeof value === 'string' && value !== '') token = value.replace(/^Bearer\s+/i, '')
    }
    const user = token === undefined ? undefined : verify(token)
    if (user === undefined) return fail(401, 'gate: invalid or expired container token')

    const upstream = new URL(provider.baseURL.replace(/\/+$/, '') + (route[2] ?? ''))
    const headers = {}
    for (const [name, value] of Object.entries(req.headers)) {
      if (!HOP_BY_HOP.has(name) && !KEY_HEADERS.includes(name)) headers[name] = value
    }
    for (const h of KEY_HEADERS) {
      if (req.headers[h] !== undefined) headers[h] = h === 'authorization' ? `Bearer ${provider.key}` : provider.key
    }
    const started = Date.now()
    const out = (upstream.protocol === 'https:' ? https : http).request(upstream, { method: req.method, headers }, up => {
      res.writeHead(up.statusCode ?? 502, Object.fromEntries(Object.entries(up.headers).filter(([n]) => !HOP_BY_HOP.has(n))))
      up.pipe(res)
      up.on('end', () => log(`[llm] ${user} ${req.method} ${provider.name}${route[2] ?? ''} ${up.statusCode} ${Date.now() - started} ms`))
    })
    out.on('error', error => { log(`[llm] ${user} ${provider.name}: ${error.message}`); fail(502, `gate: model provider unreachable (${error.message})`) })
    // A closed browser tab or aborted turn cancels the upstream call too.
    res.on('close', () => { if (!res.writableFinished) out.destroy() })
    req.pipe(out)
  })
}
