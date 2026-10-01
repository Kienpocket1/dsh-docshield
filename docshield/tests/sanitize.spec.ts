import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AdmissionError, assertSize, docKeyFromFilename, MAX_DOCUMENT_BYTES, resolveInside, sanitizeFilename } from '../src/ingest/sanitize.js'

describe('sanitizeFilename (TC-04)', () => {
  it('keeps only the last path segment', () => {
    expect(sanitizeFilename('../public_docs/quy_che.pdf')).toBe('quy_che.pdf')
    expect(sanitizeFilename('..\\..\\roles.txt')).toBe('roles.txt')
    expect(sanitizeFilename('C:\\Windows\\system32\\evil.md')).toBe('evil.md')
  })

  it('neutralises reserved characters and dot tricks', () => {
    expect(sanitizeFilename('a<b>c:d"e|f?g*h.txt')).toBe('a_b_c_d_e_f_g_h.txt')
    expect(sanitizeFilename('...hidden..txt')).toBe('hidden.txt')
    expect(sanitizeFilename('con.txt')).toBe('_con.txt')
  })

  it('keeps Vietnamese names in NFC', () => {
    expect(sanitizeFilename('Quy chế đào tạo.pdf'.normalize('NFD'))).toBe('Quy chế đào tạo.pdf'.normalize('NFC'))
  })

  it('rejects unsupported or empty names', () => {
    for (const bad of ['script.js', 'noext', 'photo.PNG', '.pdf', '../..', '']) {
      expect(() => sanitizeFilename(bad), bad).toThrow(AdmissionError)
    }
    expect(sanitizeFilename('REPORT.PDF')).toBe('REPORT.pdf')
  })

  it('caps long stems', () => {
    expect(sanitizeFilename(`${'a'.repeat(300)}.md`)).toBe(`${'a'.repeat(120)}.md`)
  })
})

describe('resolveInside', () => {
  const dir = path.resolve('/srv/storage/users/bob/docs')
  it('accepts a direct child', () => {
    expect(resolveInside(dir, 'cv.txt')).toBe(path.join(dir, 'cv.txt'))
  })
  it('refuses anything that escapes or nests', () => {
    for (const bad of ['../cv.txt', '../../alice/docs/cv.txt', 'sub/cv.txt', '..', '']) {
      expect(() => resolveInside(dir, bad), bad).toThrow(AdmissionError)
    }
  })
})

describe('assertSize and docKeyFromFilename', () => {
  it('enforces the 10MB cap', () => {
    expect(() => assertSize(MAX_DOCUMENT_BYTES)).not.toThrow()
    expect(() => assertSize(MAX_DOCUMENT_BYTES + 1)).toThrow(/10MB/)
  })
  it('derives ASCII keys', () => {
    expect(docKeyFromFilename('Quy chế Đào tạo v2.pdf')).toBe('quy_che_dao_tao_v2')
    expect(docKeyFromFilename('cv_alice.txt')).toBe('cv_alice')
    expect(docKeyFromFilename('ả.md')).toBe('doc_a')
  })
})
