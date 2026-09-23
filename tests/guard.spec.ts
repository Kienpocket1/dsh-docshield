import { describe, expect, it } from 'vitest'
import { ADMIN_TOOLS, createGuard, USER_TOOLS } from '../src/guard.js'

const ROOT = 'E:\\storage'
const guard = createGuard(ROOT, { platform: 'win32', realpath: p => p })
const call = (name: string, cwd?: string) => guard({
  name,
  ...cwd === undefined ? {} : { agent: { session: { id: 's1', header: { cwd } } } },
})

describe('createGuard', () => {
  it('allows user tools in a user workspace', () => {
    for (const tool of USER_TOOLS) expect(call(tool, 'E:\\storage\\users\\alice'), tool).toBeUndefined()
  })

  it('denies shell and file tools in a user workspace, whatever the preset (TC-07, TC-08)', () => {
    for (const tool of ['bash', 'pwsh', 'read', 'write', 'edit', 'glob', 'grep', 'web_fetch', 'run_code', 'subagent', 'probe_echo']) {
      expect(call(tool, 'E:\\storage\\users\\bob'), tool).toMatch(/không được phép/)
    }
  })

  it('denies admin tools to users', () => {
    for (const tool of ['list_tickets', 'update_ticket', 'publish_public_doc', 'reindex_document']) {
      expect(call(tool, 'E:\\storage\\users\\alice'), tool).toMatch(/không được phép/)
    }
  })

  it('allows every admin tool in the admin workspace', () => {
    for (const tool of ADMIN_TOOLS) expect(call(tool, 'E:\\storage\\admin'), tool).toBeUndefined()
    expect(call('bash', 'E:\\storage\\admin')).toMatch(/không được phép/)
  })

  it('denies everything in malformed places under the root', () => {
    expect(call('scoped_doc_search', 'E:\\storage\\public_docs')).toMatch(/không nằm trong workspace hợp lệ/)
    expect(call('scoped_doc_search', 'E:\\storage')).toMatch(/không nằm trong workspace hợp lệ/)
  })

  it('does not interfere outside the storage root or without an agent', () => {
    expect(call('bash', 'E:\\projects\\app')).toBeUndefined()
    expect(call('bash')).toBeUndefined()
  })
})
