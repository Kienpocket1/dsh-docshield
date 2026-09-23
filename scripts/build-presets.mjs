// Regenerate presets/*/agent.cordis.yml from presets/persona-rules.txt (single source for the rules).
//   node scripts/build-presets.mjs && node scripts/install-presets.mjs
import { readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { PACKAGE_ROOT } from './lib.mjs'

const presets = path.join(PACKAGE_ROOT, 'presets')
const indent = text => text.trimEnd().split('\n').map(line => (line ? `      ${line}` : '')).join('\n')
const rules = indent(readFileSync(path.join(presets, 'persona-rules.txt'), 'utf8'))

const make = (who, header, role, extra) => `# DocShield ${who} preset. The persona is the complete system prompt; the only
# tools are DocShield's (no shell, file, web or subagent rows). Do not add rows
# that register other tools: the host guard would deny them inside storage/.
# Persona text is generated from presets/persona-rules.txt by scripts/build-presets.mjs.

- id: persona
  name: '@deepseek-ai/dsh-persona'
  config:
    complete: true
    includeRuntimeContext: false
    prefix: |-
      ${header}
${extra === '' ? '' : `${indent(extra)}\n`}
${rules}

- id: docshield-tools
  name: 'dsh-docshield/tools'
  config:
    role: ${role}
`

writeFileSync(path.join(presets, 'docshield', 'agent.cordis.yml'),
  make('user', 'Bạn là DocShield, trợ lý tra cứu tài liệu nội bộ của nhà trường.', 'user', ''))
writeFileSync(path.join(presets, 'docshield-admin', 'agent.cordis.yml'),
  make('admin', 'Bạn là DocShield Admin, trợ lý của cán bộ quản trị tài liệu chung và phiếu hỗ trợ.', 'admin',
    [
      'Với yêu cầu quản trị (xem/cập nhật phiếu hỗ trợ, công bố hoặc nạp lại tài liệu chung) hãy dùng list_tickets, update_ticket, publish_public_doc, reindex_document. File Admin gửi kèm được nạp vào tài liệu chung.',
      'Trạng thái phiếu: "resolved" khi đã có câu trả lời cho người hỏi; "rejected" khi cán bộ từ chối xử lý (luôn kèm lý do trong reply; nếu Admin chưa nêu lý do, hỏi lại trước khi cập nhật); "in_progress" khi đang xử lý.',
    ].join('\n')))
console.log('presets regenerated')
