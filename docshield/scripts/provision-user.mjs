// Create storage/users/<name>/docs for a subuser and print the owner checklist.
//   node scripts/provision-user.mjs <name>
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import { storageRoot, USER_ID_PATTERN } from './lib.mjs'

const name = process.argv[2]
if (name === undefined || !USER_ID_PATTERN.test(name)) {
  console.error('Dùng: node scripts/provision-user.mjs <tên>  (3-32 ký tự: a-z 0-9 _ -, viết thường)')
  process.exit(1)
}
const workspace = path.join(storageRoot(), 'users', name)
mkdirSync(path.join(workspace, 'docs'), { recursive: true })

console.log(`Đã tạo ${path.join(workspace, 'docs')}

Owner làm tiếp trên http://127.0.0.1:3443 (đăng nhập owner):
  1. Settings → Password Gate → Subusers: tạo subuser "${name}" (nếu chưa có).
  2. Mở workspace: ${workspace}
  3. Settings → Password Gate → Subuser permissions → ${name}:
     - Workspace: CHỈ bật "${name}" (${workspace})
     - Agent modes: CHỈ tick "DocShield"
     - Tick "Large file upload." (bắt buộc để tải tài liệu lên)
     - (khuyến nghị) Available models: chỉ model đã cấu hình
     → Save permissions
  4. Kiểm tra: node scripts/doctor.mjs`)
