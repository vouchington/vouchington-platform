import Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it } from 'vitest'
import { classifyAnthropicError, ModelProviderError } from './errors.mts'
import { isAmbiguousBilledHttpStatus, parseRetryAfter, readHeader } from './http.mts'

function apiError(status: number, message = 'boom', headers: Record<string, string> = {}) {
  return Anthropic.APIError.generate(status, { error: { message } }, message, new Headers(headers))
}

describe('classifyAnthropicError', () => {
  it('returns aborts and unknown errors unchanged', () => {
    const abort = new Anthropic.APIUserAbortError()
    expect(classifyAnthropicError(abort)).toBe(abort)
    expect(classifyAnthropicError('plain')).toBe('plain')
    const noStatus = new Anthropic.APIError(undefined, undefined, 'x', undefined)
    expect(classifyAnthropicError(noStatus)).toBe(noStatus)
  })

  it('maps connection failures to transient ambiguous errors', () => {
    const result = classifyAnthropicError(new Anthropic.APIConnectionError({ message: 'down' }))
    expect(result).toBeInstanceOf(ModelProviderError)
    expect(result).toMatchObject({
      code: 'connection',
      retryClass: 'transient',
      ambiguousBilled: true,
    })
  })

  it.each([
    [429, 'rate-limited', 'transient', true],
    [529, 'overloaded', 'transient', true],
    [500, 'server-error', 'transient', true],
    [401, 'authentication', 'permanent', false],
    [403, 'permission', 'permanent', false],
    [408, 'invalid-request', 'transient', true],
    [422, 'invalid-request', 'permanent', false],
  ])('maps HTTP %i', (status, code, retryClass, ambiguousBilled) => {
    expect(classifyAnthropicError(apiError(status))).toMatchObject({
      code,
      retryClass,
      status,
      ambiguousBilled,
    })
  })

  it('names a low credit balance and honours retry-after on transient failures', () => {
    expect(classifyAnthropicError(apiError(400, 'Your credit balance is too low'))).toMatchObject({
      code: 'credit-balance-too-low',
      retryClass: 'permanent',
    })
    expect(classifyAnthropicError(apiError(400, 'bad'))).toMatchObject({ code: 'invalid-request' })
    const limited = classifyAnthropicError(apiError(429, 'slow', { 'retry-after': '3' }))
    expect(limited).toMatchObject({ retryAfterMs: 3000 })
    const noHeader = classifyAnthropicError(apiError(503)) as ModelProviderError
    expect(noHeader.retryAfterMs).toBeUndefined()
    const permanent = classifyAnthropicError(apiError(401, 'x', { 'retry-after': '3' }))
    expect((permanent as ModelProviderError).retryAfterMs).toBeUndefined()
  })
})

describe('ModelProviderError', () => {
  it('defaults ambiguousBilled to false', () => {
    const error = new ModelProviderError('refusal', 'no', { retryClass: 'permanent' })
    expect(error).toMatchObject({ name: 'ModelProviderError', ambiguousBilled: false })
  })
})

describe('http helpers', () => {
  it('parses retry-after seconds and dates', () => {
    expect(parseRetryAfter(undefined)).toBeNull()
    expect(parseRetryAfter('  ')).toBeNull()
    expect(parseRetryAfter('2')).toBe(2000)
    expect(parseRetryAfter('nonsense')).toBeNull()
    const now = Date.parse('2026-01-01T00:00:00Z')
    expect(parseRetryAfter('Thu, 01 Jan 2026 00:00:10 GMT', now)).toBe(10_000)
    expect(parseRetryAfter('Wed, 31 Dec 2025 23:59:00 GMT', now)).toBe(0)
    expect(typeof parseRetryAfter('1')).toBe('number')
  })

  it('flags statuses that may have billed', () => {
    for (const status of [408, 409, 429, 500, 503]) {
      expect(isAmbiguousBilledHttpStatus(status)).toBe(true)
    }
    expect(isAmbiguousBilledHttpStatus(400)).toBe(false)
  })

  it('reads headers from Headers, plain objects, and junk', () => {
    expect(readHeader(new Headers({ 'Retry-After': '1' }), 'retry-after')).toBe('1')
    expect(readHeader(new Headers(), 'retry-after')).toBeUndefined()
    expect(readHeader({ 'Retry-After': '2' }, 'retry-after')).toBe('2')
    expect(readHeader({ 'retry-after': 3 }, 'retry-after')).toBeUndefined()
    expect(readHeader(undefined, 'retry-after')).toBeUndefined()
  })
})
