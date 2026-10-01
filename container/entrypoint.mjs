/**
 * Container entrypoint, started by firewall.mjs as user node with no
 * capabilities: prepare this user's DSH home (a per-user volume at DSH_HOME),
 * write the per-user patch, then run `dsh --profile web`.
 *
 * Inputs (set by dsh-gate):
 *   GATE_USER   account name; GATE_ROLE user|admin
 *   DOCSHIELD_SERVICE_URL  host DocShield service, e.g. http://host.docker.internal:3492
 *   DOCSHIELD_TOKEN        per-container token the gate registered with that service
 *   /storage/users/<u> (or /storage/admin)  the owner's folder, bind-mounted; no database here
 *   /template   read-only: settings.yaml and .credentials.yaml (API key refs only)
 *
 * The web server binds 0.0.0.0 inside the container so the published port
 * works; Docker publishes it on the host's 127.0.0.1 only, and DSH's own
 * token cookie still guards it.
 */
import { spawn } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const HOME = process.env.DSH_HOME ?? '/home/dsh'
const PORT = 3090
const DSH_BIN = '/opt/dsh/node_modules/@deepseek-ai/dsh/lib/bin.js'
const BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', 'dsh-docshield']

const user = process.env.GATE_USER ?? ''
const role = process.env.GATE_ROLE === 'admin' ? 'admin' : 'user'
if (!/^[a-z0-9][a-z0-9_-]{2,31}$/.test(user)) {
  console.error(`entrypoint: invalid GATE_USER ${JSON.stringify(user)}`)
  process.exit(2)
}
// S4: the container is the sandbox, so its preset keeps DSH's own tools beside DocShield's (built into the image).
const preset = role === 'admin' ? 'docshield-admin-harness' : 'docshield-harness'
// Without the host service DocShield would fall back to opening its own database: refuse instead.
if (!process.env.DOCSHIELD_SERVICE_URL || !process.env.DOCSHIELD_TOKEN) {
  console.error('entrypoint: DOCSHIELD_SERVICE_URL and DOCSHIELD_TOKEN are required')
  process.exit(2)
}

// Profile: package list only; the packages themselves live in the image.
const profile = path.join(HOME, 'profiles', 'web')
if (!existsSync(path.join(profile, 'package.json'))) {
  mkdirSync(profile, { recursive: true })
  writeFileSync(path.join(profile, 'package.json'), JSON.stringify({ name: 'dsh-profile-web', private: true, dsh: { profile: { bundles: BUNDLES } } }, null, 2))
  writeFileSync(path.join(profile, 'cordis.yml'), '[]\n')
  writeFileSync(path.join(profile, 'cordis.patch.yml'), '[]\n')
  symlinkSync('/opt/profile-web/node_modules', path.join(profile, 'node_modules'))
}

// Settings come from the template on every start; loopback model URLs point back at the host.
const settings = readFileSync('/template/settings.yaml', 'utf8')
  .replace(/(https?:\/\/)(127\.0\.0\.1|localhost)(?=[:/])/g, '$1host.docker.internal')
writeFileSync(path.join(HOME, 'settings.yaml'), `${settings.trimEnd()}\n\n# dsh-gate (managed)\nagent-presets:\n  modeSelectionEnabled: false\n  default: ${preset}\n`)

// Credentials only on first start: DSH adds this instance's own browser-session secret to the file.
const credentials = path.join(HOME, '.credentials.yaml')
if (!existsSync(credentials) && existsSync('/template/.credentials.yaml')) cpSync('/template/.credentials.yaml', credentials)
if (existsSync(credentials)) {
  // No API key may live in the home: the gate's model proxy holds them (a home from before S2 still had one).
  writeFileSync(credentials, withoutRefs(readFileSync(credentials, 'utf8')))
  // A copy from a Windows bind mount arrives as 777; DSH refuses a credentials file others can read.
  chmodSync(credentials, 0o600)
}

// Presets follow the image version.
cpSync('/opt/docshield/presets', path.join(HOME, '.agent-presets'), { recursive: true, filter: src => !src.endsWith('.txt') })

const identity = role === 'admin' ? '    identity:\n      role: admin\n' : `    identity:\n      user: ${JSON.stringify(user)}\n`
const patch = path.join(HOME, 'gate.patch.yml')
writeFileSync(patch, [
  '# Written by the container entrypoint on every start; edits are overwritten.',
  '- id: webserver',
  '  config:',
  "    host: '0.0.0.0'",
  `    port: ${PORT}`,
  '    compression: gzip',
  '    compressionLevel: 1',
  '    compressionThresholdBytes: 1024',
  '- id: agent-presets',
  '  config:',
  `    default: ${preset}`,
  '- id: docshield-core',
  '  config:',
  "    storageRoot: '/storage'",
  // The token itself stays in the environment (DOCSHIELD_TOKEN), not in this file.
  `    serviceUrl: ${JSON.stringify(process.env.DOCSHIELD_SERVICE_URL ?? '')}`,
  '    allowOtherTools: true',
  identity.trimEnd(),
  '',
].join('\n'))

/** The credentials file with its top-level `refs` section emptied; `records` (this container's own secrets) stay. */
function withoutRefs(text) {
  const out = []
  let skipping = false
  for (const line of text.split(/\r?\n/)) {
    if (/^refs:/.test(line)) { skipping = true; continue }
    if (skipping && /^\s/.test(line)) continue
    skipping = false
    out.push(line)
  }
  return `${out.join('\n').trimEnd()}\nrefs: {}\n`
}

const child = spawn(process.execPath, [DSH_BIN, '--patch', patch, '--profile', 'web', '--no-open'], { stdio: 'inherit' })
for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => child.kill(signal))
child.on('exit', (code, signal) => process.exit(code ?? (signal ? 1 : 0)))
