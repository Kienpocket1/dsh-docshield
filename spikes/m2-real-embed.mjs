import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { vectorBlob } from '../dist/db/database.js'
import { WorkerEmbedder } from '../dist/embed/embedder.js'
import { targetForPath } from '../dist/ingest/layout.js'
import { DocShieldService } from '../dist/service.js'

const root = mkdtempSync(path.join(tmpdir(), 'docshield-real-'))
mkdirSync(path.join(root, 'users/alice/docs'), { recursive: true })
mkdirSync(path.join(root, 'public_docs'), { recursive: true })
const embedder = new WorkerEmbedder({ modelsDir: 'E:/Deepseek_Harness/spike-dshpw/storage/.docshield/models' })
const svc = new DocShieldService(root, { embedder, log: m => console.log('  log:', m), dbFile: ':memory:' })
const put = (rel, text) => { const f = path.join(root, rel); writeFileSync(f, text); return svc.indexer.ingest(targetForPath(root, f)) }
let t = performance.now()
console.log(await put('users/alice/docs/cv_alice.txt', 'Mã số cá nhân của Alice là AL-99.'))
console.log(await put('public_docs/quy_che.md', 'Điều 5. Học bổng\nSinh viên có điểm trung bình từ 3.2 trở lên được xét học bổng khuyến khích.\n\nĐiều 6. Thư viện\nThư viện mở cửa từ 7h30 đến 21h.\n\nĐiều 7. Hỗ trợ tài chính\nSinh viên được vay vốn theo chương trình tín dụng của ngân hàng chính sách xã hội.'))
console.log('ingest ms', Math.round(performance.now() - t))
for (const [scope, q] of [['user:alice', 'Mã số của tôi là gì?'], ['public', 'Điểm bao nhiêu thì có học bổng?'], ['public', 'Vay 100 triệu mua xe máy được không?']]) {
  const [v] = await embedder.embed([q])
  const rows = svc.db.prepare(`SELECT c.locator, round(1 - v.distance, 3) AS sim FROM vec_chunks v JOIN chunks c ON c.id = v.rowid
    WHERE v.embedding MATCH ? AND k = 3 AND v.scope = ? ORDER BY v.distance`).all(vectorBlob(v), scope)
  console.log(q, '→', rows.map(r => `${r.locator}:${r.sim}`).join(' '))
}
await svc.dispose()
rmSync(root, { recursive: true, force: true })
console.log('rss MB', Math.round(process.memoryUsage().rss / 1048576))
