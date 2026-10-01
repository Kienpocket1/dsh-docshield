/**
 * Split parsed pages into retrieval chunks. Sections start at "Chương"/"Điều"
 * headings or Markdown headings; within a section paragraphs are packed up to
 * ~TARGET characters with a sentence-aligned overlap so a fact near a boundary
 * lives whole in at least one chunk. Each chunk carries a human locator
 * ("tr.3 · Điều 5") used by evidence cards.
 */
import type { ParsedDocument } from './parse.js'

export interface Chunk {
  readonly ord: number
  readonly text: string
  readonly locator: string
}

export const TARGET_CHARS = 1800
export const OVERLAP_CHARS = 200

const ARTICLE = /^\s*(?:Điều|Dieu|ĐIỀU|DIEU)\s+(\d+[a-zđ]?)\b/u
const CHAPTER = /^\s*(?:Chương|Chuong|CHƯƠNG|CHUONG)\s+([IVXLC]+|\d+)\b/u
const MD_HEADING = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/u

interface Paragraph {
  text: string
  page: number
  label: string | undefined
}

export function chunkDocument(doc: ParsedDocument): Chunk[] {
  const paragraphs = toParagraphs(doc)
  const chunks: Chunk[] = []
  let i = 0
  while (i < paragraphs.length) {
    // One section = consecutive paragraphs sharing a label.
    const label = paragraphs[i]!.label
    const section: Paragraph[] = []
    while (i < paragraphs.length && paragraphs[i]!.label === label) section.push(paragraphs[i++]!)
    packSection(section, doc.kind, chunks)
  }
  return chunks
}

function toParagraphs(doc: ParsedDocument): Paragraph[] {
  const out: Paragraph[] = []
  let label: string | undefined
  let chapter: string | undefined
  for (const { page, text } of doc.pages) {
    const lines = text.normalize('NFC').replace(/\r\n?/g, '\n').split('\n')
    let buffer: string[] = []
    const flush = () => {
      const joined = buffer.join(' ').replace(/[ \t]+/g, ' ').trim()
      if (joined !== '') out.push({ text: joined, page, label })
      buffer = []
    }
    for (const line of lines) {
      const article = ARTICLE.exec(line)
      const chap = CHAPTER.exec(line)
      const heading = MD_HEADING.exec(line)
      if (article || chap || heading) {
        flush()
        if (chap) {
          chapter = `Chương ${chap[1]}`
          label = chapter
        } else if (article) {
          label = `Điều ${article[1]}`
        } else if (heading) {
          label = heading[1]!.slice(0, 60)
        }
        buffer.push(line.trim())
        continue
      }
      if (line.trim() === '') flush()
      else buffer.push(line.trim())
    }
    flush()
  }
  return out
}

function packSection(section: Paragraph[], kind: ParsedDocument['kind'], out: Chunk[]): void {
  const label = section[0]?.label
  let carry = '' // overlap copied from the previous chunk of this section
  let body = '' // new content; a chunk is only emitted when this is non-empty
  let page = section[0]?.page ?? 1
  const emit = () => {
    const text = carry === '' ? body : `${carry}\n${body}`
    out.push({ ord: out.length, text, locator: locatorFor(kind, page, label, out.length) })
    carry = tailOverlap(text)
    body = ''
  }
  for (const para of section) {
    for (const piece of splitLong(para.text)) {
      if (body !== '' && carry.length + body.length + piece.length + 2 > TARGET_CHARS) emit()
      if (body === '') page = para.page
      body = body === '' ? piece : `${body}\n${piece}`
    }
  }
  if (body !== '') emit()
}

/** Last ~OVERLAP_CHARS of `text`, starting at a sentence or word boundary. */
function tailOverlap(text: string): string {
  if (text.length <= OVERLAP_CHARS) return text
  const tail = text.slice(-OVERLAP_CHARS)
  const sentence = tail.search(/[.!?;:]\s+\S/u)
  if (sentence >= 0) return tail.slice(sentence + 1).trimStart()
  const space = tail.indexOf(' ')
  return space >= 0 ? tail.slice(space + 1) : tail
}

/** Break a paragraph longer than the target at sentence ends, then hard-cut. */
function splitLong(text: string): string[] {
  if (text.length <= TARGET_CHARS) return [text]
  const sentences = text.match(/[^.!?;]+[.!?;]+[\])"'”’]*\s*|[^.!?;]+$/gu) ?? [text]
  const parts: string[] = []
  let buf = ''
  for (const s of sentences) {
    if (buf.length + s.length > TARGET_CHARS && buf !== '') {
      parts.push(buf.trim())
      buf = ''
    }
    if (s.length > TARGET_CHARS) {
      for (let i = 0; i < s.length; i += TARGET_CHARS) parts.push(s.slice(i, i + TARGET_CHARS).trim())
    } else buf += s
  }
  if (buf.trim() !== '') parts.push(buf.trim())
  return parts
}

function locatorFor(kind: ParsedDocument['kind'], page: number, label: string | undefined, ord: number): string {
  const parts: string[] = []
  if (kind === 'pdf') parts.push(`tr.${page}`)
  if (label !== undefined) parts.push(label)
  if (parts.length === 0) parts.push(`đoạn ${ord + 1}`)
  return parts.join(' · ')
}
