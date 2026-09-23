import { describe, expect, it } from 'vitest'
import { isAnswerMeta, isTicketMeta, readCall } from '../src/client/model.js'

const answer = { answer: 'AL-99', evidence: [{ filename: 'cv.txt', locator: 'đoạn 1', scope: 'cá nhân', quote: 'Mã số là AL-99' }] }

describe('readCall', () => {
  it('reads a running call from argsRaw', () => {
    expect(readCall({ argsRaw: '{"query":"học bổng"}' }, isAnswerMeta)).toEqual({ settled: false, args: { query: 'học bổng' }, meta: undefined, error: undefined })
  })

  it('reads settled meta and call args', () => {
    const state = readCall({ kind: 'tool-result', call: { argsRaw: '{"answer":"x"}' }, content: [], isError: false, meta: answer }, isAnswerMeta)
    expect(state).toMatchObject({ settled: true, args: { answer: 'x' }, meta: answer })
  })

  it('surfaces tool errors as text', () => {
    const state = readCall({ kind: 'tool-result', call: null, content: [{ type: 'text', text: 'Trích dẫn không khớp' }], isError: true }, isAnswerMeta)
    expect(state).toMatchObject({ settled: true, error: 'Trích dẫn không khớp', meta: undefined })
  })

  it('tolerates malformed args and meta (replay of older logs)', () => {
    expect(readCall({ argsRaw: '{"query":"hoc' }, isAnswerMeta).args).toEqual({})
    expect(readCall({ kind: 'tool-result', call: null, content: [], meta: { answer: 1 } }, isAnswerMeta).meta).toBeUndefined()
    expect(readCall(undefined, isAnswerMeta).settled).toBe(false)
  })
})

describe('ticket meta guard', () => {
  it('accepts created, found and not-found shapes', () => {
    const ticket = { code: 'TICK-101', statusLabel: 'Đang chờ xử lý' }
    expect(isTicketMeta({ ticket, reused: false })).toBe(true)
    expect(isTicketMeta({ found: true, ticket })).toBe(true)
    expect(isTicketMeta({ found: false, code: 'TICK-9' })).toBe(true)
    expect(isTicketMeta({ found: false })).toBe(false)
  })
})
