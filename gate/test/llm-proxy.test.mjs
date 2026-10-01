/** Model proxy (docker mode): containers hold only their token; the proxy swaps in the real key. */
import assert from 'node:assert/strict'
import http from 'node:http'
import { after, before, describe, it } from 'node:test'
import { createLlmProxy, credentialValues, parseProviders, proxiedSettings } from '../src/llm-proxy.mjs'

const SETTINGS = [
  'ui-onboarding:',
  '  welcomeNoticeVersion: x',
  'llm-pi-ai:',
  '  providers:',
  '    nien-router:',
  '      apiKeyEnv: NIEN_ROUTER_API_KEY',
  '      api: openai-completions',
  "      baseURL: 'http://127.0.0.1:20128/v1'",
  '      models:',
  '        - id: my-models-free',
  '    deepseek:',
  '      apiKeyEnv: DEEPSEEK_API_KEY',
  'agent-default-model:',
  '  provider: nien-router',
  '',
].join('\n')

describe('settings and credentials parsing', () => {
  it('finds providers and rewrites only proxied baseURLs', () => {
    assert.deepEqual(parseProviders(SETTINGS), [
      { name: 'nien-router', apiKeyEnv: 'NIEN_ROUTER_API_KEY', baseURL: 'http://127.0.0.1:20128/v1' },
      { name: 'deepseek', apiKeyEnv: 'DEEPSEEK_API_KEY' },
    ])
    const out = proxiedSettings(SETTINGS, 'http://host.docker.internal:3494', ['nien-router'])
    assert.match(out, /^ {6}baseURL: http:\/\/host\.docker\.internal:3494\/llm\/nien-router$/m)
    assert.equal(out.split('\n').length, SETTINGS.split('\n').length)
    assert.deepEqual([...credentialValues('version: 1\nrefs:\n  A_KEY: "sk-1"\n  B: two\nrecords: {}\n')], [['A_KEY', 'sk-1'], ['B', 'two']])
  })
})

describe('proxy', () => {
  let upstream, proxy, proxyPort
  const seen = []
  before(async () => {
    upstream = http.createServer((req, res) => {
      seen.push({ url: req.url, auth: req.headers.authorization })
      res.writeHead(200, { 'content-type': 'text/event-stream' })
      res.write('data: one\n\n')
      setTimeout(() => res.end('data: [DONE]\n\n'), 20)
    })
    await new Promise(r => upstream.listen(0, '127.0.0.1', r))
    proxy = createLlmProxy({
      providers: [{ name: 'router', baseURL: `http://127.0.0.1:${upstream.address().port}/v1`, key: 'REAL-KEY' }],
      verify: token => (token === 'c'.repeat(43) ? 'alice' : undefined),
    })
    await new Promise(r => proxy.listen(0, '127.0.0.1', r))
    proxyPort = proxy.address().port
  })
  after(() => { proxy.close(); upstream.close() })

  const post = (path, auth) => fetch(`http://127.0.0.1:${proxyPort}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: `Bearer ${auth}` } : {}) }, body: '{"stream":true}',
  })

  it('refuses requests without a live container token', async () => {
    assert.equal((await post('/llm/router/chat/completions')).status, 401)
    assert.equal((await post('/llm/router/chat/completions', 'REAL-KEY')).status, 401)
    assert.equal(seen.length, 0)
  })

  it('swaps the token for the real key and streams the answer through', async () => {
    const res = await post('/llm/router/chat/completions', 'c'.repeat(43))
    assert.equal(res.status, 200)
    assert.equal(await res.text(), 'data: one\n\ndata: [DONE]\n\n')
    assert.deepEqual(seen.at(-1), { url: '/v1/chat/completions', auth: 'Bearer REAL-KEY' })
  })

  it('only serves configured providers', async () => {
    assert.equal((await post('/llm/other/chat/completions', 'c'.repeat(43))).status, 404)
  })
})
