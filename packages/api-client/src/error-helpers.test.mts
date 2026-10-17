import { describe, expect, it } from 'vitest'
import { ApiError } from './error.mts'
import {
  createErrorCodeChecker,
  getApiErrorMessage,
  hasErrorCode,
  parseErrorDigest,
} from './error-helpers.mts'

describe('getApiErrorMessage', () => {
  it('returns the ApiError message', () => {
    expect(getApiErrorMessage(new ApiError('boom', 500), 'fallback')).toBe('boom')
  })

  it('prefers plain text, then error, then message payloads', () => {
    expect(getApiErrorMessage(new ApiError('generic', 400, 'plain text'), 'fallback')).toBe(
      'plain text',
    )
    expect(
      getApiErrorMessage(new ApiError('generic', 400, { error: 'specific', message: 'm' }), 'f'),
    ).toBe('specific')
    expect(getApiErrorMessage(new ApiError('generic', 400, { error: '' }), 'f')).toBe('generic')
    expect(getApiErrorMessage(new ApiError('generic', 400, { error: 3 }), 'f')).toBe('generic')
  })

  it('falls back through empty strings and non-object data', () => {
    expect(getApiErrorMessage(new ApiError('generic', 400, ''), 'f')).toBe('generic')
    expect(getApiErrorMessage(new ApiError('generic', 400), 'f')).toBe('generic')
  })

  it('returns the fallback for other values', () => {
    expect(getApiErrorMessage(new Error('other'), 'fallback')).toBe('fallback')
    expect(getApiErrorMessage(null, 'fallback')).toBe('fallback')
  })
})

describe('error codes', () => {
  it('matches ApiError codes', () => {
    const error = new ApiError('Unauthorized', 401, { code: 'SESSION_EXPIRED' })
    expect(hasErrorCode(error, 'SESSION_EXPIRED')).toBe(true)
    expect(hasErrorCode(error, 'OTHER')).toBe(false)
    expect(hasErrorCode(new Error('boom'), 'SESSION_EXPIRED')).toBe(false)
  })

  it('checks names against an injected catalog', () => {
    const is = createErrorCodeChecker({ expired: 'SESSION_EXPIRED', limit: 'LIMIT' })
    const error = new ApiError('Unauthorized', 401, { code: 'SESSION_EXPIRED' })
    expect(is(error, 'expired')).toBe(true)
    expect(is(error, 'limit')).toBe(false)
  })
})

describe('parseErrorDigest', () => {
  const copy = { 429: { title: 'Slow down', description: 'Too fast' } }
  const fallback = { title: 'Oops', description: 'Try again' }

  it('uses injected copy by status and the fallback otherwise', () => {
    expect(parseErrorDigest('EXPECTED_CLIENT_ERROR;429', copy, fallback)).toEqual({
      status: 429,
      ...copy[429],
    })
    expect(parseErrorDigest('EXPECTED_CLIENT_ERROR;418', copy, fallback)).toEqual({
      status: 418,
      ...fallback,
    })
  })

  it('returns null for unrecognized digests', () => {
    expect(parseErrorDigest('NEXT_HTTP_ERROR_FALLBACK;404', copy, fallback)).toBeNull()
    expect(parseErrorDigest(undefined, copy, fallback)).toBeNull()
  })
})
