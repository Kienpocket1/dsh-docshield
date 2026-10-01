/** Text extraction: TXT/MD as UTF-8, PDF page by page through unpdf (pdf.js). */
import { readFile } from 'node:fs/promises'
import path from 'node:path'

export interface ParsedPage {
  /** 1-based page number; plain-text files are a single page. */
  readonly page: number
  readonly text: string
}

export interface ParsedDocument {
  readonly kind: 'pdf' | 'text'
  readonly pages: readonly ParsedPage[]
}

export class ParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ParseError'
  }
}

export async function parseDocument(filePath: string, bytes?: Uint8Array): Promise<ParsedDocument> {
  const data = bytes ?? new Uint8Array(await readFile(filePath))
  const ext = path.extname(filePath).toLowerCase()
  if (ext === '.pdf') return parsePdf(data)
  const text = new TextDecoder('utf-8', { fatal: false }).decode(data).replace(/^﻿/, '')
  if (text.trim() === '') throw new ParseError('File không có nội dung chữ.')
  return { kind: 'text', pages: [{ page: 1, text }] }
}

async function parsePdf(data: Uint8Array): Promise<ParsedDocument> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  let pages: string[]
  try {
    const pdf = await getDocumentProxy(data)
    pages = (await extractText(pdf, { mergePages: false })).text
  } catch (error) {
    throw new ParseError(`Không đọc được PDF: ${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = pages.map((text, i) => ({ page: i + 1, text })).filter(p => p.text.trim() !== '')
  if (parsed.length === 0) throw new ParseError('PDF không có lớp chữ (có thể là bản scan; chưa hỗ trợ OCR).')
  return { kind: 'pdf', pages: parsed }
}
