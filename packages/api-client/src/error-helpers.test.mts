import { describe, expect, it } from 'vitest'
import { ApiError } from './error.mts'
import {
  createErrorCodeChecker,
  getApiErrorMessage,
  getRetryAfterMs,
  getRetryAfterSeconds,
  hasErrorCode,
  isRateLimitError,
  parseErrorDigest,
  returnNullForMissingEntity,
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

describe('rate limit and retry-after helpers', () => {
  it('identifies HTTP 429 ApiErrors only', () => {
    expect(isRateLimitError(new ApiError('Slow down', 429))).toBe(true)
    expect(isRateLimitError(new ApiError('Conflict', 409))).toBe(false)
    expect(isRateLimitError(new Error('429'))).toBe(false)
  })

  it('extracts retry_after in whole seconds and milliseconds', () => {
    const fractional = new ApiError('Slow down', 429, { retry_after: 1.5 })
    expect(getRetryAfterSeconds(fractional)).toBe(2)
    expect(getRetryAfterMs(fractional)).toBe(1500)

    const whole = new ApiError('Slow down', 429, { retry_after: 12 })
    expect(getRetryAfterSeconds(whole)).toBe(12)
    expect(getRetryAfterMs(whole)).toBe(12_000)
  })

  it('returns 0 / null for non-429 errors or missing, invalid, or non-positive retry_after', () => {
    const cases: unknown[] = [
      new Error('not api error'),
      new ApiError('Conflict', 409, { retry_after: 10 }),
      new ApiError('Slow down', 429),
      new ApiError('Slow down', 429, null),
      new ApiError('Slow down', 429, ['10']),
      new ApiError('Slow down', 429, 'plain text'),
      new ApiError('Slow down', 429, { retry_after: 0 }),
      new ApiError('Slow down', 429, { retry_after: -5 }),
      new ApiError('Slow down', 429, { retry_after: Number.POSITIVE_INFINITY }),
      new ApiError('Slow down', 429, { retry_after: '10' }),
    ]
    for (const value of cases) {
      expect(getRetryAfterSeconds(value)).toBe(0)
      expect(getRetryAfterMs(value)).toBeNull()
    }
  })
})

describe('returnNullForMissingEntity', () => {
  it('returns the resolved value when the request succeeds', async () => {
    await expect(returnNullForMissingEntity(Promise.resolve({ id: '1' }))).resolves.toEqual({
      id: '1',
    })
  })

  it('returns null for 404 by default and propagates other statuses', async () => {
    await expect(
      returnNullForMissingEntity(Promise.reject(new ApiError('Not found', 404))),
    ).resolves.toBeNull()

    const forbidden = new ApiError('Forbidden', 403)
    await expect(returnNullForMissingEntity(Promise.reject(forbidden))).rejects.toBe(forbidden)
  })

  it('supports custom nullStatusCodes and propagates non-ApiError rejections', async () => {
    await expect(
      returnNullForMissingEntity(Promise.reject(new ApiError('Forbidden', 403)), {
        nullStatusCodes: [403, 404],
      }),
    ).resolves.toBeNull()

    const network = new Error('Network failure')
    await expect(
      returnNullForMissingEntity(Promise.reject(network), { nullStatusCodes: [403, 404] }),
    ).rejects.toBe(network)
  })
})
