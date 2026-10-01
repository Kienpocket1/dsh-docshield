/**
 * Argument checks for raw JSON-Schema tools (the registry does not validate
 * them for us). Messages are Vietnamese because the model reads them and retries.
 */
export class ArgumentError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ArgumentError'
  }
}

export function requireString(args: Record<string, unknown>, key: string, { min = 1, max = 4000 } = {}): string {
  const value = args[key]
  if (typeof value !== 'string' || value.trim().length < min) throw new ArgumentError(`Thiếu tham số "${key}" (chuỗi không rỗng).`)
  if (value.length > max) throw new ArgumentError(`Tham số "${key}" quá dài (tối đa ${max} ký tự).`)
  return value.trim()
}

export function optionalInt(args: Record<string, unknown>, key: string, lo: number, hi: number): number | undefined {
  const value = args[key]
  if (value === undefined || value === null) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < lo || value > hi) {
    throw new ArgumentError(`Tham số "${key}" phải là số nguyên từ ${lo} đến ${hi}.`)
  }
  return value
}

export function requireCitations(args: Record<string, unknown>): { chunkId: string; quote: string }[] {
  const value = args.citations
  if (!Array.isArray(value) || value.length === 0) throw new ArgumentError('Thiếu "citations" (mảng ít nhất một trích dẫn).')
  if (value.length > 8) throw new ArgumentError('Tối đa 8 trích dẫn.')
  return value.map((item, i) => {
    if (typeof item !== 'object' || item === null) throw new ArgumentError(`citations[${i}] phải là object {chunkId, quote}.`)
    const { chunkId, quote } = item as Record<string, unknown>
    const id = typeof chunkId === 'number' ? String(chunkId) : chunkId
    if (typeof id !== 'string' || id.trim() === '') throw new ArgumentError(`citations[${i}].chunkId thiếu.`)
    if (typeof quote !== 'string' || quote.trim() === '') throw new ArgumentError(`citations[${i}].quote thiếu.`)
    if (quote.length > 1000) throw new ArgumentError(`citations[${i}].quote quá dài (tối đa 1000 ký tự).`)
    return { chunkId: id.trim(), quote }
  })
}
