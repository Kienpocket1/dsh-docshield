import { cpSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { WorkerEmbedder } from '../dist/embed/embedder.js'
import { DocShieldService } from '../dist/service.js'

const src = 'E:/Deepseek_Harness/spike-dshpw/storage'
const root = mkdtempSync(path.join(tmpdir(), 'docshield-cal-'))
for (const d of ['users', 'public_docs']) cpSync(path.join(src, d), path.join(root, d), { recursive: true })
const svc = new DocShieldService(root, {
  embedder: new WorkerEmbedder({ modelsDir: `${src}/.docshield/models` }), log: () => {}, dbFile: ':memory:', minSimilarity: 0.45,
})
await svc.watcher.reconcile()
const alice = { role: 'user', userId: 'alice' }
const cases = [
  ['ok', 'Mã số cá nhân của tôi là gì?'],
  ['ok', 'Điểm trung bình bao nhiêu thì được học bổng khuyến khích?'],
  ['ok', 'Học bổng khuyến khích bằng bao nhiêu phần trăm học phí?'],
  ['ok', 'Thư viện mở cửa mấy giờ?'],
  ['ok', 'Chủ nhật thư viện có mở cửa không?'],
  ['ok', 'Sinh viên khó khăn vay vốn ở đâu?'],
  ['ok', 'Bài thơ Việt Bắc nói về điều gì?'],
  ['ok', 'Đoạn văn mẫu về lòng hiếu thuận viết gì?'],
  ['trap', 'Trường có chính sách hỗ trợ sinh viên vay 100 triệu mua xe máy không?'],
  ['trap', 'Học phí năm nay tăng bao nhiêu?'],
  ['trap', 'Ký túc xá có cho nuôi mèo không?'],
  ['trap', 'Mã số cá nhân của Bob là gì?'],
  ['trap', 'Lịch thi học kỳ 2 là ngày nào?'],
  ['trap', 'Trường có bãi đỗ xe ô tô cho sinh viên không?'],
  ['trap', 'Giáo viên chủ nhiệm lớp tôi tên gì?'],
  ['trap', 'Giá vé xe buýt tới trường là bao nhiêu?'],
]
for (const [kind, q] of cases) {
  const { hits } = await svc.search('cal', alice, q, 3)
  const top = (hits.length === 0 ? 'KHÔNG CÓ KẾT QUẢ' : '') + hits.map(h => `${h.similarity.toFixed(3)} ${h.filename.slice(0, 18)}·${h.locator}`).join(' | ')
  console.log(kind.padEnd(4), q.slice(0, 52).padEnd(52), '→', top)
}
await svc.dispose()
rmSync(root, { recursive: true, force: true })
