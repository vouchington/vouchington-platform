import { describe, expect, it } from 'vitest'
import { ApiError, isExpectedApiError } from './error.mts'

describe('ApiError', () => {
  it('sets the Next.js fallback digest for 401/403/404', () => {
    expect(new ApiError('Not authenticated', 401).digest).toBe('NEXT_HTTP_ERROR_FALLBACK;401')
    expect(new ApiError('Forbidden', 403).digest).toBe('NEXT_HTTP_ERROR_FALLBACK;403')
    expect(new ApiError('Not found', 404).digest).toBe('NEXT_HTTP_ERROR_FALLBACK;404')
  })

  it('sets a status-bearing digest for other 4xx statuses', () => {
    expect(new ApiError('Bad request', 400).digest).toBe('EXPECTED_CLIENT_ERROR;400')
    expect(new ApiError('Rate limited', 429).digest).toBe('EXPECTED_CLIENT_ERROR;429')
  })

  it('does not set a digest outside 4xx', () => {
    expect(new ApiError('Server error', 500).digest).toBeUndefined()
    expect(new ApiError('Redirect', 302).digest).toBeUndefined()
  })

  it('prefers the backend message and preserves code and request id', () => {
    const error = new ApiError('fallback', 401, {
      message: 'Unauthorized',
      code: 'SESSION_EXPIRED',
      request_id: 'req-123',
    })
    expect(error.message).toBe('Unauthorized')
    expect(error.code).toBe('SESSION_EXPIRED')
    expect(error.requestId).toBe('req-123')
    expect(error.name).toBe('ApiError')
  })

  it('ignores non-string message, code, and request id fields', () => {
    const error = new ApiError('fallback', 400, { message: 1, code: 2, request_id: 3 })
    expect(error.message).toBe('fallback')
    expect(error.code).toBeUndefined()
    expect(error.requestId).toBeUndefined()
  })

  it('does not read fields from Error causes or primitives', () => {
    const cause = Object.assign(new Error('inner'), { code: 'ECONN' })
    const wrapped = new ApiError('outer', 500, cause)
    expect(wrapped.message).toBe('outer')
    expect(wrapped.code).toBeUndefined()
    expect(wrapped.data).toBe(cause)
    expect(new ApiError('text', 400, 'plain').code).toBeUndefined()
  })
})

describe('isExpectedApiError', () => {
  it('matches 4xx ApiErrors and duck-typed equivalents', () => {
    expect(isExpectedApiError(new ApiError('Bad request', 400))).toBe(true)
    expect(isExpectedApiError({ name: 'ApiError', status: 499 })).toBe(true)
  })

  it('rejects non-4xx and malformed values', () => {
    expect(isExpectedApiError(new ApiError('Server error', 500))).toBe(false)
    expect(isExpectedApiError({ name: 'ApiError', status: 399 })).toBe(false)
    expect(isExpectedApiError({ name: 'ApiError', status: '401' })).toBe(false)
    expect(isExpectedApiError({ name: 'ApiError' })).toBe(false)
    expect(isExpectedApiError({ name: 'Other', status: 400 })).toBe(false)
    expect(isExpectedApiError({ status: 400 })).toBe(false)
    expect(isExpectedApiError(null)).toBe(false)
    expect(isExpectedApiError('ApiError')).toBe(false)
  })
})
