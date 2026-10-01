import assert from 'node:assert/strict'
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, rmdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { after, describe, it } from 'node:test'
import { InstanceManager } from '../src/instance.mjs'

const dir = mkdtempSync(path.join(tmpdir(), 'dsh-gate-inst-'))
const tpl = path.join(dir, 'template')
mkdirSync(path.join(tpl, 'profiles', 'web', 'node_modules'), { recursive: true })
mkdirSync(path.join(tpl, '.agent-presets', 'docshield'), { recursive: true })
writeFileSync(path.join(tpl, 'settings.yaml'), 'agent-default-model:\n  model: m\n')
writeFileSync(path.join(tpl, '.credentials.yaml'), 'k: v\n')

const manager = new InstanceManager({
  dshBin: 'unused', homesDir: path.join(dir, 'homes'), templateHome: tpl, bundles: ['a', 'b'],
  docshield: { storageRoot: 'E:/store', embedUrl: 'http://127.0.0.1:3490/embed' }, idleMs: 0,
})
after(() => {
  // Remove junctions with rmdir first so rm never walks into the template.
  for (const u of ['alice', 'boss']) {
    try { rmdirSync(path.join(dir, 'homes', u, 'profiles', 'web', 'node_modules')) } catch { /* absent */ }
  }
  rmSync(dir, { recursive: true, force: true })
})

describe('per-user home', () => {
  it('copies settings/credentials/presets, links node_modules, pins the DocShield preset', () => {
    const home = manager.ensureHome({ username: 'alice', role: 'user' })
    assert.ok(lstatSync(path.join(home, 'profiles', 'web', 'node_modules')).isSymbolicLink())
    assert.equal(readFileSync(path.join(home, '.credentials.yaml'), 'utf8'), 'k: v\n')
    const pkg = JSON.parse(readFileSync(path.join(home, 'profiles', 'web', 'package.json'), 'utf8'))
    assert.deepEqual(pkg.dsh.profile.bundles, ['a', 'b'])
    manager.ensureHome({ username: 'alice', role: 'user' })
    const settings = readFileSync(path.join(home, 'settings.yaml'), 'utf8')
    assert.equal(settings.match(/agent-presets:/g).length, 1, 'managed block is rewritten, not duplicated')
    assert.match(settings, /modeSelectionEnabled: false\n {2}default: docshield\n/)
    assert.match(settings, /agent-default-model/)
  })

  it('patch pins identity and embedder per role', () => {
    const userHome = manager.ensureHome({ username: 'alice', role: 'user' })
    const user = readFileSync(manager.writePatch({ username: 'alice', role: 'user' }, userHome), 'utf8')
    assert.match(user, /- id: docshield-core/)
    assert.match(user, /identity:\n {6}user: "alice"/)
    assert.match(user, /embedUrl: "http:\/\/127\.0\.0\.1:3490\/embed"/)
    assert.match(user, /default: docshield\n/)
    const adminHome = manager.ensureHome({ username: 'boss', role: 'admin' })
    const admin = readFileSync(manager.writePatch({ username: 'boss', role: 'admin' }, adminHome), 'utf8')
    assert.match(admin, /identity:\n {6}role: admin/)
    assert.match(admin, /default: docshield-admin/)
    assert.match(readFileSync(path.join(adminHome, 'settings.yaml'), 'utf8'), /default: docshield-admin/)
  })
})

describe('docker template', () => {
  it('holds no secrets and routes models through the gate proxy', () => {
    const creds = 'version: 1\nrecords:\n  client-connection/browser-session:\n    kind: grant\n    payload:\n      secret: SHARED\nrefs:\n  ROUTER_KEY: real-key\n'
    const settings = 'llm-pi-ai:\n  providers:\n    router:\n      apiKeyEnv: ROUTER_KEY\n      api: openai-completions\n      baseURL: http://127.0.0.1:20128/v1\n      models:\n        - id: m\nagent-default-model:\n  provider: router\n'
    const tplDocker = path.join(dir, 'tpl-docker')
    mkdirSync(tplDocker)
    writeFileSync(path.join(tplDocker, 'settings.yaml'), settings)
    writeFileSync(path.join(tplDocker, '.credentials.yaml'), creds)
    const docker = new InstanceManager({ templateHome: tplDocker, idleMs: 0, runtime: 'docker', docker: { templateDir: path.join(dir, 'docker-template'), llmUrl: 'http://host.docker.internal:3494' } })
    assert.deepEqual(docker.llmProviders(), [{ name: 'router', apiKeyEnv: 'ROUTER_KEY', baseURL: 'http://127.0.0.1:20128/v1', key: 'real-key' }])
    const out = docker.writeDockerTemplate()
    assert.doesNotMatch(readFileSync(path.join(out, '.credentials.yaml'), 'utf8'), /SHARED|browser-session|real-key/)
    const outSettings = readFileSync(path.join(out, 'settings.yaml'), 'utf8')
    assert.match(outSettings, /baseURL: http:\/\/host\.docker\.internal:3494\/llm\/router\n/)
    assert.doesNotMatch(outSettings, /20128/)
    assert.match(outSettings, /agent-default-model:\n {2}provider: router/)
  })
})

