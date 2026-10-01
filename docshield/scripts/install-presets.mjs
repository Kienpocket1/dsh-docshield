// Copy the DocShield presets into <DSH_HOME>/.agent-presets and create the storage skeleton.
//   DSH_HOME=... node scripts/install-presets.mjs
import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import path from 'node:path'
import { dshHome, PACKAGE_ROOT, PRESET_IDS, storageRoot } from './lib.mjs'

const target = path.join(dshHome(), '.agent-presets')
mkdirSync(target, { recursive: true })
for (const id of PRESET_IDS) {
  const dest = path.join(target, id)
  if (existsSync(dest)) rmSync(dest, { recursive: true, force: true })
  cpSync(path.join(PACKAGE_ROOT, 'presets', id), dest, { recursive: true })
  console.log(`preset ${id} → ${dest}`)
}

const root = storageRoot()
for (const dir of ['users', 'admin', 'public_docs', '.docshield']) {
  mkdirSync(path.join(root, dir), { recursive: true })
}
console.log(`storage → ${root} (users/, admin/, public_docs/, .docshield/)`)
