import { describe, expect, it } from 'vitest'
import { createCodedError } from './coded-error.mts'
import {
  HttpNoBodyError,
  HttpRateLimitError,
  HttpResponseSizeError,
  HttpServerError,
} from './http-errors.mts'

describe('createCodedError', () => {
  it('creates an http-errors error with a status and stable code', () => {
    const error = createCodedError(409, 'Conflict here', 'CONFLICT')
    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ status: 409, code: 'CONFLICT', message: 'Conflict here' })
  })
})

describe('HTTP error classes', () => {
  it('classifies rate limits', () => {
    const error = new HttpRateLimitError('https://a.test', 429, 1500)
    expect(error).toMatchObject({
      name: 'HttpRateLimitError',
      code: 'HTTP_RATE_LIMIT',
      status: 429,
      retryAfterMs: 1500,
    })
    expect(error.message).toBe('Rate limited for https://a.test, retry after 1500ms')
  })

  it('classifies server errors', () => {
    const error = new HttpServerError('https://a.test', 503)
    expect(error).toMatchObject({ name: 'HttpServerError', code: 'HTTP_SERVER_ERROR', status: 503 })
    expect(error.message).toBe('Server error 503 for https://a.test')
  })

  it('classifies oversized responses', () => {
    const error = new HttpResponseSizeError('https://a.test', 20, 10)
    expect(error).toMatchObject({
      name: 'HttpResponseSizeError',
      code: 'HTTP_RESPONSE_SIZE_EXCEEDED',
      status: 413,
      actualSize: 20,
      maxSize: 10,
    })
    expect(error.message).toBe('Response size exceeded limit: 20 > 10 bytes for https://a.test')
  })

  it('classifies missing bodies', () => {
    const error = new HttpNoBodyError('https://a.test')
    expect(error).toMatchObject({ name: 'HttpNoBodyError', code: 'HTTP_NO_BODY', status: 502 })
    expect(error.message).toBe('No response body for https://a.test')
  })
})
