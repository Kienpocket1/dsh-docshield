/**
 * Reverse proxy from the gate to one user's DSH instance, for plain HTTP and
 * WebSocket upgrades (`/api/remote.mux`). The upstream sees itself as the
 * authority (Host/Origin rewritten, so DSH's browser-trust fence passes) and
 * receives only DSH's own auth cookie; browser cookies never go upstream and
 * upstream cookies never reach the browser.
 */
import http from 'node:http'
import net from 'node:net'

const HOP_BY_HOP = new Set([
  'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
  'te', 'trailer', 'transfer-encoding', 'upgrade',
])

/** Headers for the upstream request. */
export function upstreamHeaders(incoming, instance, { keepUpgrade = false } = {}) {
  const out = {}
  for (const [name, value] of Object.entries(incoming)) {
    if (value === undefined) continue
    const key = name.toLowerCase()
    if (key === 'cookie' || key === 'host' || key === 'origin' || key === 'referer') continue
    if (!keepUpgrade && HOP_BY_HOP.has(key)) continue
    out[key] = value
  }
  const authority = `127.0.0.1:${instance.port}`
  out.host = authority
  out.cookie = instance.cookie
  if (incoming.origin !== undefined) out.origin = `http://${authority}`
  if (incoming.referer !== undefined) {
    try {
      const ref = new URL(incoming.referer)
      out.referer = `http://${authority}${ref.pathname}${ref.search}`
    } catch { /* drop malformed referer */ }
  }
  return out
}

/** Headers for the browser response. */
export function downstreamHeaders(upstream, instance) {
  const out = {}
  for (const [name, value] of Object.entries(upstream)) {
    if (value === undefined) continue
    const key = name.toLowerCase()
    if (key === 'set-cookie' || HOP_BY_HOP.has(key)) continue
    out[key] = value
  }
  const location = out.location
  if (typeof location === 'string' && location.startsWith(instance.origin)) {
    out.location = location.slice(instance.origin.length) || '/'
  }
  return out
}

export function proxyHttp(req, res, instance) {
  const upstream = http.request({
    host: '127.0.0.1',
    port: instance.port,
    method: req.method,
    path: req.url,
    headers: upstreamHeaders(req.headers, instance),
  }, upRes => {
    res.writeHead(upRes.statusCode ?? 502, downstreamHeaders(upRes.headers, instance))
    upRes.pipe(res)
  })
  upstream.on('error', err => {
    if (!res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(`Gate: không kết nối được phiên làm việc (${err.message})`)
  })
  req.pipe(upstream)
}

export function proxyUpgrade(req, socket, head, instance) {
  const upstream = net.connect(instance.port, '127.0.0.1', () => {
    const headers = upstreamHeaders(req.headers, instance, { keepUpgrade: true })
    let raw = `${req.method} ${req.url} HTTP/1.1\r\n`
    for (const [name, value] of Object.entries(headers)) {
      for (const v of Array.isArray(value) ? value : [value]) raw += `${name}: ${v}\r\n`
    }
    upstream.write(`${raw}\r\n`)
    if (head.length > 0) upstream.write(head)
    upstream.pipe(socket)
    socket.pipe(upstream)
  })
  const close = () => { upstream.destroy(); socket.destroy() }
  upstream.on('error', close)
  socket.on('error', close)
  upstream.on('close', () => socket.destroy())
  socket.on('close', () => upstream.destroy())
}
