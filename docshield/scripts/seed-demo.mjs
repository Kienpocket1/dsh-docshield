// Prepare demo data under the storage root.
//   node scripts/seed-demo.mjs                 add missing demo files (never deletes)
//   node scripts/seed-demo.mjs --reset         list what a reset would delete
//   node scripts/seed-demo.mjs --reset --yes   delete documents + docshield.db, then seed (DocShield must be stopped)
//
// Seeded before the demo: public quy_che_hoc_vu.md (v1) and bob's cv_bob.txt.
// Kept in demo/ for live upload during the demo: cv_alice.txt (TC-01), quy_che_hoc_vu_v2.md (TC-05).
// Never touched: accounts and permissions (dsh-passwords), workspaces, chat sessions, model settings.
import { execSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs'
import path from 'node:path'
import { PACKAGE_ROOT, storageRoot } from './lib.mjs'

const args = new Set(process.argv.slice(2))
const root = storageRoot()
const demo = path.join(PACKAGE_ROOT, 'demo')
const SEED = [
  ['quy_che_hoc_vu.md', 'public_docs'],
  ['cv_bob.txt', 'users/bob/docs'],
]

function listFiles(dir) {
  if (!existsSync(dir)) return []
  return readdirSync(dir).map(n => path.join(dir, n)).filter(p => statSync(p).isFile())
}

function dshRunning() {
  try {
    return execSync('netstat -ano', { encoding: 'utf8' }).split('\n').some(l => /127\.0\.0\.1:3090\s.*LISTENING/.test(l))
  } catch {
    return false
  }
}

if (args.has('--reset')) {
  const doomed = [
    ...listFiles(path.join(root, 'public_docs')),
    ...readdirSync(path.join(root, 'users')).flatMap(u => listFiles(path.join(root, 'users', u, 'docs'))),
    ...['docshield.db', 'docshield.db-wal', 'docshield.db-shm'].map(f => path.join(root, '.docshield', f)).filter(existsSync),
  ]
  console.log(`Reset sẽ xóa ${doomed.length} file:`)
  for (const f of doomed) console.log(`  - ${path.relative(root, f)}`)
  console.log('(Giữ nguyên: tài khoản, quyền, workspace, phiên chat, model bge-m3, cấu hình model.)')
  if (!args.has('--yes')) {
    console.log('\nChưa xóa gì. Chạy lại với --reset --yes để thực hiện.')
    process.exit(0)
  }
  if (dshRunning()) {
    console.error('\n[LỖI] DocShield đang chạy (cổng 3090). Tắt cửa sổ start-gate.cmd rồi chạy lại.')
    process.exit(1)
  }
  for (const f of doomed) rmSync(f, { force: true })
  console.log('Đã xóa.')
}

for (const dir of ['users/alice/docs', 'users/bob/docs', 'admin', 'public_docs', '.docshield']) mkdirSync(path.join(root, dir), { recursive: true })
for (const [file, dir] of SEED) {
  const dest = path.join(root, dir, file)
  if (existsSync(dest)) {
    console.log(`giữ  ${dir}/${file}`)
    continue
  }
  copyFileSync(path.join(demo, file), dest)
  console.log(`thêm ${dir}/${file}`)
}
console.log(`\nFile dùng trong lúc demo (gửi kèm qua chat): ${path.join(demo, 'cv_alice.txt')}, ${path.join(demo, 'quy_che_hoc_vu_v2.md')}`)
