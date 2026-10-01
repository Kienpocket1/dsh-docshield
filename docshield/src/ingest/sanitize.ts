/**
 * File admission for ingestion (TC-04): only a bare, safe filename with an
 * allowed extension, under the size cap, landing strictly inside its target
 * directory is accepted.
 */
import path from 'node:path'

export const ALLOWED_EXTENSIONS: ReadonlySet<string> = new Set(['.pdf', '.txt', '.md'])
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
const MAX_STEM_CHARS = 120
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i

export class AdmissionError extends Error {
  constructor(message: string, readonly code: 'BAD_NAME' | 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'OUTSIDE') {
    super(message)
    this.name = 'AdmissionError'
  }
}

/**
 * Reduce an untrusted name to its last path segment and make it safe on both
 * Windows and POSIX. Throws rather than guessing when nothing usable remains.
 */
export function sanitizeFilename(input: string): string {
  const base = input.split(/[\\/]/).pop() ?? ''
  let name = base
    .normalize('NFC')
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '_')
    .replace(/\.{2,}/g, '.')
    .replace(/^[.\s]+|[.\s]+$/g, '')
  const ext = path.extname(name).toLowerCase()
  let stem = name.slice(0, name.length - path.extname(name).length).trim()
  if (stem === '' ) throw new AdmissionError(`Tên file không hợp lệ: "${input}"`, 'BAD_NAME')
  if (!ALLOWED_EXTENSIONS.has(ext)) {
    throw new AdmissionError(`Chỉ nhận file PDF, TXT, MD (nhận được "${ext || 'không có đuôi'}")`, 'UNSUPPORTED_TYPE')
  }
  if (WINDOWS_RESERVED.test(stem)) stem = `_${stem}`
  if ([...stem].length > MAX_STEM_CHARS) stem = [...stem].slice(0, MAX_STEM_CHARS).join('')
  name = `${stem}${ext}`
  return name
}

export function assertSize(bytes: number): void {
  if (bytes > MAX_DOCUMENT_BYTES) {
    throw new AdmissionError(`File vượt quá giới hạn 10MB (${(bytes / 1048576).toFixed(1)}MB)`, 'TOO_LARGE')
  }
}

/** Join a sanitized name onto `dir` and prove the result is a direct child of it. */
export function resolveInside(dir: string, filename: string): string {
  const root = path.resolve(dir)
  const target = path.resolve(root, filename)
  const rel = path.relative(root, target)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel) || rel.includes(path.sep) || rel.includes('/')) {
    throw new AdmissionError(`Đường dẫn nằm ngoài thư mục cho phép: ${filename}`, 'OUTSIDE')
  }
  return target
}

/** Stable per-scope document identity derived from a filename: ASCII, lower-case, underscores. */
export function docKeyFromFilename(filename: string): string {
  const stem = filename.slice(0, filename.length - path.extname(filename).length)
  const key = stem
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 64)
  return key.length >= 2 ? key : `doc_${key || 'x'}`
}
