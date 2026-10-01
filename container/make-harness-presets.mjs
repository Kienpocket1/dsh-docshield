/**
 * Image build step (sandbox S4): the container presets "DocShield + công cụ"
 * (user and admin) = every row of DSH's own Standard preset (shell, files,
 * search, jobs, skills, plans, subagents…) with DocShield's persona and tools.
 * Built from the Standard preset of the DSH version in this image, so a DSH
 * upgrade brings its tool rows along. Only containers use these presets: their
 * tools run inside the container's sandbox (no host disk, firewalled network).
 *   node make-harness-presets.mjs <dsh standard preset dir> <docshield presets dir>
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const [standardDir, presetsDir] = process.argv.slice(2)
const standard = readFileSync(path.join(standardDir, 'agent.cordis.yml'), 'utf8')
// Rows are the top-level list items; the Standard persona row is replaced by ours.
const rows = standard.split(/^(?=- id: )/m).filter(chunk => chunk.startsWith('- id: '))
// The plugin manager would let the agent rewrite its own DSH profile; the container has no registry access anyway.
const toolRows = rows.filter(row => !row.startsWith('- id: persona\n') && !row.startsWith('- id: tool-plugin-manager\n'))
if (toolRows.length === rows.length) throw new Error('make-harness-presets: Standard preset has no persona row; its layout changed')
if (!toolRows.some(row => /name: '@deepseek-ai\/dsh-tool-fs'/.test(row))) throw new Error('make-harness-presets: Standard preset has no file tools; its layout changed')

const indent = (text, spaces) => text.trimEnd().split('\n').map(line => (line ? `${' '.repeat(spaces)}${line}` : '')).join('\n')
const rules = readFileSync(path.join(presetsDir, 'persona-rules.txt'), 'utf8')

const WORKSPACE = [
  'Ngoài tra cứu tài liệu, bạn là một agent đầy đủ: có shell, đọc/ghi/sửa file, tìm file, chạy job, lập kế hoạch và subagent.',
  'Mọi công cụ chạy trong một sandbox riêng của người dùng này: chỉ thấy workspace {{cwd}} và thư mục nhà của phiên; không có mạng ra ngoài (trừ dịch vụ DocShield và model).',
  '- File đặt trong {{cwd}}/docs được DocShield tự nạp làm tài liệu cá nhân (tài liệu chung chỉ admin công bố).',
  '- Câu hỏi về NỘI DUNG tài liệu (quy chế, hồ sơ, tài liệu đã nạp) vẫn phải theo đúng quy trình DocShield dưới đây, không trả lời bằng hiểu biết riêng hay bằng cách tự đọc file thay cho scoped_doc_search.',
  '- Việc khác (soạn/sửa file, xử lý dữ liệu, viết và chạy code…) thì làm bằng các công cụ trên, trong workspace.',
].join('\n')

const make = (header, role, extra) => `# Generated at image build by container/make-harness-presets.mjs: DSH Standard tool rows + DocShield.
# Container only: the host guard allows these tools only with docshield-core allowOtherTools (set in containers).

- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    suffix: 'Thư mục làm việc: {{cwd}}.'
    prefix: |-
${indent(`${header}\n${WORKSPACE}${extra ? `\n${extra}` : ''}\n\nVới câu hỏi về nội dung tài liệu:\n${rules}`, 6)}

${toolRows.map(row => row.trimEnd()).join('\n')}

- id: docshield-tools
  name: 'dsh-docshield/tools'
  config:
    role: ${role}
`

const write = (id, name, description, body) => {
  mkdirSync(path.join(presetsDir, id), { recursive: true })
  writeFileSync(path.join(presetsDir, id, 'preset.yml'), `name: ${name}\ndescription: ${description}\norder: 0\n`)
  writeFileSync(path.join(presetsDir, id, 'agent.cordis.yml'), body)
}
write('docshield-harness', 'DocShield + công cụ', 'Tra cứu tài liệu có trích dẫn, kèm shell và file trong sandbox riêng.',
  make('Bạn là DocShield, trợ lý tra cứu tài liệu nội bộ của nhà trường.', 'user', ''))
write('docshield-admin-harness', 'DocShield Admin + công cụ', 'Quản trị tài liệu chung và phiếu hỗ trợ, kèm shell và file trong sandbox riêng.',
  make('Bạn là DocShield Admin, trợ lý của cán bộ quản trị tài liệu chung và phiếu hỗ trợ.', 'admin',
    'Với yêu cầu quản trị (xem/cập nhật phiếu hỗ trợ, công bố hoặc nạp lại tài liệu chung) hãy dùng list_tickets, update_ticket, publish_public_doc, reindex_document. "rejected" luôn kèm lý do trong reply.'))
console.log(`harness presets: ${toolRows.length} Standard rows + DocShield`)
