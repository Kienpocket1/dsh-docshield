import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { chunkDocument, TARGET_CHARS } from '../src/ingest/chunk.js'
import { parseDocument, ParseError } from '../src/ingest/parse.js'

const fixtures = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures')

describe('chunkDocument', () => {
  it('starts a section at each "Điều N" and labels chunks', () => {
    const text = [
      'QUY CHẾ ĐÀO TẠO',
      '',
      'Điều 5. Học bổng khuyến khích',
      'Sinh viên có điểm trung bình từ 3.2 trở lên được xét học bổng.',
      '',
      'Điều 6. Thư viện',
      'Thư viện mở cửa từ 7h30 đến 21h.',
    ].join('\n')
    const chunks = chunkDocument({ kind: 'text', pages: [{ page: 1, text }] })
    expect(chunks.map(c => c.locator)).toEqual(['đoạn 1', 'Điều 5', 'Điều 6'])
    expect(chunks[1]!.text).toContain('3.2 trở lên')
    expect(chunks[2]!.text).not.toContain('học bổng')
  })

  it('keeps PDF page numbers in locators', () => {
    const chunks = chunkDocument({ kind: 'pdf', pages: [{ page: 3, text: 'Điều 9. Kỷ luật\nNội dung.' }] })
    expect(chunks[0]!.locator).toBe('tr.3 · Điều 9')
  })

  it('bounds chunk size and overlaps consecutive chunks', () => {
    const sentence = 'Sinh viên phải hoàn thành đầy đủ các học phần bắt buộc theo chương trình đào tạo. '
    const chunks = chunkDocument({ kind: 'text', pages: [{ page: 1, text: sentence.repeat(80) }] })
    expect(chunks.length).toBeGreaterThan(2)
    for (const c of chunks) expect(c.text.length).toBeLessThanOrEqual(TARGET_CHARS + 250)
    const tail = chunks[0]!.text.slice(-60)
    expect(chunks[1]!.text).toContain(tail.slice(tail.indexOf(' ') + 1))
    expect(chunks.map(c => c.ord)).toEqual(chunks.map((_c, i) => i))
  })

  it('never emits an overlap-only chunk', () => {
    const chunks = chunkDocument({ kind: 'text', pages: [{ page: 1, text: 'Một câu ngắn.' }] })
    expect(chunks).toHaveLength(1)
  })
})

describe('parseDocument', () => {
  it('extracts PDF text per page', async () => {
    const doc = await parseDocument(path.join(fixtures, 'quy_che_mini.pdf'))
    expect(doc.kind).toBe('pdf')
    expect(doc.pages[0]!.text).toContain('Dieu 5. Hoc bong')
    expect(chunkDocument(doc)[0]!.locator).toBe('tr.1 · Điều 5')
  })

  it('strips a UTF-8 BOM and rejects empty text', async () => {
    const bom = new Uint8Array([0xef, 0xbb, 0xbf, ...new TextEncoder().encode('Xin chào')])
    expect((await parseDocument('a.txt', bom)).pages[0]!.text).toBe('Xin chào')
    await expect(parseDocument('a.txt', new TextEncoder().encode('  \n '))).rejects.toThrow(ParseError)
  })

  it('reports a broken PDF as a ParseError', async () => {
    await expect(parseDocument('x.pdf', new TextEncoder().encode('not a pdf'))).rejects.toThrow(ParseError)
  })
})
