#!/usr/bin/env node
// dsh-gate CLI.
//   node bin/gate.mjs serve                     start the gate
//   node bin/gate.mjs user add <name> [--role user|admin] [--password-stdin]
//   node bin/gate.mjs user passwd <name> [--password-stdin]
//   node bin/gate.mjs user disable|enable <name>
//   node bin/gate.mjs user approve|reject <name>   (self-registration requests)
//   node bin/gate.mjs user list
//   node bin/gate.mjs audit [n]
import { execFileSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { createGate } from '../src/app.mjs'
import { EmbedService } from '../src/embed-service.mjs'
import { loadConfig } from '../src/config.mjs'
import { InstanceManager } from '../src/instance.mjs'
import { createLlmProxy } from '../src/llm-proxy.mjs'
import { hashPassword } from '../src/password.mjs'
import { loadSecret } from '../src/session.mjs'
import { GateStore } from '../src/store.mjs'

const config = loadConfig()
mkdirSync(config.varDir, { recursive: true })
const store = new GateStore(path.join(config.varDir, 'gate.db'))
const [cmd, sub, name] = process.argv.slice(2)
const flag = f => process.argv.includes(f)
const option = (f, fallback) => { const i = process.argv.indexOf(f); return i > 0 ? process.argv[i + 1] : fallback }

try {
  if (cmd === 'serve') await serve()
  else if (cmd === 'user' && sub === 'add') {
    store.addUser(name, option('--role', 'user'), await hashPassword(await askPassword(true)))
    store.audit('user_added', { username: name, detail: option('--role', 'user') })
    console.log(`Đã tạo tài khoản ${name}.`)
  } else if (cmd === 'user' && sub === 'passwd') {
    store.setPassword(name, await hashPassword(await askPassword(true)))
    store.audit('password_changed', { username: name })
    console.log(`Đã đổi mật khẩu ${name}; các phiên đăng nhập cũ bị hủy.`)
  } else if (cmd === 'user' && (sub === 'disable' || sub === 'enable')) {
    store.setDisabled(name, sub === 'disable')
    store.audit(`user_${sub}d`, { username: name })
    console.log(`${sub === 'disable' ? 'Đã khóa' : 'Đã mở khóa'} ${name}.`)
  } else if (cmd === 'user' && (sub === 'approve' || sub === 'reject')) {
    store[sub](name)
    store.audit(sub === 'approve' ? 'approved' : 'rejected', { username: name, detail: 'bởi dòng lệnh' })
    console.log(`${sub === 'approve' ? 'Đã duyệt' : 'Đã từ chối'} ${name}.`)
  } else if (cmd === 'user' && sub === 'list') {
    console.table(store.listUsers())
  } else if (cmd === 'audit') {
    console.table(store.recentAudit(Number(sub ?? 30)))
  } else {
    console.log('Dùng: node bin/gate.mjs serve | user add|passwd|disable|enable|approve|reject|list <tên> | audit [n]')
    process.exitCode = 1
  }
} catch (err) {
  console.error(`Lỗi: ${err.message}`)
  process.exitCode = 1
} finally {
  if (cmd !== 'serve') store.close()
}

async function serve() {
  const log = msg => console.log(`${new Date().toISOString().slice(11, 19)} ${msg}`)
  const docker = config.instances.runtime === 'docker'
  if (docker) {
    const { bin, image } = config.instances.docker
    try {
      execFileSync(bin, ['image', 'inspect', image], { stdio: 'ignore', windowsHide: true })
    } catch {
      console.error(`[LOI] GATE_RUNTIME=docker nhung khong dung duoc image ${image} (Docker Desktop chua chay, hoac chua build: docker build -f container/Dockerfile -t ${image} .)`)
      process.exit(1)
    }
  }
  const storageEnv = { DOCSHIELD_STORAGE_ROOT: config.instances.docshield.storageRoot }
  const embed = new EmbedService({ ...config.embed, args: config.embed.models ? ['--models', config.embed.models] : [], env: storageEnv, log })
  await embed.start()
  log(`embedding service: ${embed.url}`)

  let docshield
  let instances
  if (docker) {
    // Docker mode: the host DocShield service owns the database; containers get per-start tokens.
    const adminKey = randomBytes(32).toString('base64url')
    const tokenCall = async (method, body) => {
      const res = await fetch(`${docshield.origin}/v1/tokens`, { method, headers: { 'x-docshield-admin': adminKey, 'content-type': 'application/json' }, body: JSON.stringify(body) })
      if (!res.ok) throw new Error(`DocShield token ${method} failed: HTTP ${res.status}`)
    }
    config.instances.docshieldTokens = {
      register: (token, scope) => tokenCall('PUT', { token, scope }),
      revoke: token => tokenCall('DELETE', { token }),
    }
    docshield = new EmbedService({
      ...config.docshieldServer, name: 'docshield-server', args: ['--embed-url', embed.url],
      env: { ...storageEnv, DOCSHIELD_ADMIN_KEY: adminKey },
      // A restarted service has forgotten the tokens of running containers.
      onHealthy: () => instances?.reRegisterTokens(),
      log,
    })
    await docshield.start()
    log(`runtime: docker (image ${config.instances.docker.image}); DocShield service ${docshield.origin}`)
  }
  instances = new InstanceManager({ ...config.instances, log })
  let llmProxy
  if (docker) {
    // Containers never get the real model keys: their provider routes point here with their own token.
    const providers = instances.llmProviders()
    llmProxy = createLlmProxy({ providers, verify: token => instances.tokenOwner(token), log })
    await new Promise((resolve, reject) => llmProxy.once('error', reject).listen(config.llmProxyPort, '127.0.0.1', resolve))
    log(`model proxy: http://127.0.0.1:${config.llmProxyPort} (${providers.map(p => p.name).join(', ') || 'no provider with baseURL + key'})`)
  }
  const orphans = instances.removeOrphans()
  if (orphans.length) log(`removed leftover containers: ${orphans.join(', ')}`)
  // No account yet: allow /gate/setup, guarded by a one-time key only this console shows.
  const setupKey = store.countUsers() === 0 ? randomBytes(6).toString('hex').match(/.{4}/g).join('-') : undefined
  const gate = createGate({ store, secret: loadSecret(path.join(config.varDir, 'secret.key')), instances, setupKey, trustProxy: config.trustProxy, log })
  await new Promise(resolve => gate.listen(config.port, config.host, resolve))
  log(`dsh-gate: http://${config.host}:${config.port}`)
  if (setupKey !== undefined) {
    console.log('')
    console.log('  ================= THIET LAP LAN DAU =================')
    console.log(`  Chua co tai khoan. Mo http://${config.host}:${config.port}/gate/setup`)
    console.log(`  Ma thiet lap:  ${setupKey}`)
    console.log('  (Ma dung mot lan; trang tu khoa sau khi tao admin.)')
    console.log('  =====================================================')
    console.log('')
  }
  const shutdown = async () => {
    log('Đang tắt các phiên làm việc...')
    await instances.stopAll()
    llmProxy?.close()
    docshield?.stop()
    embed.stop()
    store.close()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
  // Windows: closing the console window raises SIGHUP; stop the per-user DSH children too.
  process.on('SIGHUP', shutdown)
}

/** Password from stdin (--password-stdin) or a hidden TTY prompt, asked twice when confirming. */
async function askPassword(confirm) {
  if (flag('--password-stdin')) {
    const chunks = []
    for await (const c of process.stdin) chunks.push(c)
    // PowerShell pipes may prefix a BOM; it is never part of the password.
    return Buffer.concat(chunks).toString('utf8').replace(/^﻿/, '').replace(/\r?\n$/, '')
  }
  const first = await hiddenPrompt('Mật khẩu: ')
  if (confirm && first !== await hiddenPrompt('Nhập lại: ')) throw new Error('Hai lần nhập không khớp.')
  return first
}

function hiddenPrompt(question) {
  return new Promise(resolve => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = s => { if (s.includes(question)) process.stdout.write(question) }
    rl.question(question, answer => { rl.close(); process.stdout.write('\n'); resolve(answer) })
  })
}
