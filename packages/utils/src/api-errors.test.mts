import { describe, expect, it } from 'vitest'

import {
  buildApiErrorEnvelope,
  getErrorResponseCode,
  getErrorResponseMessage,
  getErrorResponseStack,
  getErrorStatus,
  getStatusMessage,
  normalizeErrorForLogging,
} from './api-errors.mts'

const throwingMessage = {
  message: {
    toString(): string {
      throw new Error('boom')
    },
  },
}
const unprintable = { toString: () => ({}) } as unknown

describe('api-errors', () => {
  it('resolves statuses', () => {
    expect(getErrorStatus('x')).toBe(500)
    expect(getErrorStatus({ status: 404 })).toBe(404)
    expect(getErrorStatus({ status: 99, statusCode: 422 })).toBe(422)
    expect(getErrorStatus({ status: 1.5, statusCode: 600 })).toBe(500)
    expect(getErrorStatus({ status: 200, statusCode: 503 })).toBe(503)
    expect(getErrorStatus({ status: 302 })).toBe(500)
    expect(getErrorStatus({ status: 399 })).toBe(500)
    expect(getStatusMessage(404)).toBe('Not Found')
    expect(getStatusMessage(599)).toBe('Internal Server Error')
  })

  it('stamps status on 5xx errors only', () => {
    const server = Object.assign(new Error('a'), { statusCode: 503 })
    expect(normalizeErrorForLogging(server)).toHaveProperty('status', 503)
    const client = Object.assign(new Error('a'), { status: 400 })
    expect(normalizeErrorForLogging(client)).toHaveProperty('status', 400)
    expect(normalizeErrorForLogging(new Error('a'))).toHaveProperty('status', 500)
  })

  it('survives hostile thrown values', () => {
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error('trap')
        },
      },
    )
    const getter = {
      get status(): number {
        throw new Error('status')
      },
      get code(): string {
        throw new Error('code')
      },
      get stack(): string {
        throw new Error('stack')
      },
    }
    for (const value of [hostile, getter]) {
      expect(getErrorStatus(value)).toBe(500)
      expect(getErrorResponseCode(value, 500)).toBe('INTERNAL_ERROR')
      expect(getErrorResponseStack(value)).toBeUndefined()
      expect(buildApiErrorEnvelope(value, { exposeDetails: true }).body).toEqual({
        message: 'Internal Server Error',
        code: 'INTERNAL_ERROR',
      })
    }
  })

  it('derives messages', () => {
    expect(getErrorResponseMessage(new Error('bad'), 400)).toBe('bad')
    expect(getErrorResponseMessage({ message: 7 }, 400)).toBe('7')
    expect(getErrorResponseMessage(throwingMessage, 404)).toBe('Not Found')
    expect(getErrorResponseMessage({}, 404)).toBe('Not Found')
    expect(getErrorResponseMessage({ message: null }, 404)).toBe('Not Found')
    expect(getErrorResponseMessage({ message: undefined }, 404)).toBe('Not Found')
    expect(getErrorResponseMessage(null, 500)).toBe('Internal Server Error')
    expect(getErrorResponseMessage(undefined, 400)).toBe('Bad Request')
    expect(getErrorResponseMessage('text', 400)).toBe('text')
    expect(getErrorResponseMessage(unprintable, 400)).toBe('Bad Request')
  })

  it('derives codes and stacks', () => {
    expect(getErrorResponseCode({ code: 'X' }, 400)).toBe('X')
    expect(getErrorResponseCode({ code: 1 }, 400)).toBeUndefined()
    expect(getErrorResponseCode({}, 502)).toBe('INTERNAL_ERROR')
    expect(getErrorResponseStack({ stack: 's' })).toBe('s')
    expect(getErrorResponseStack({ stack: 1 })).toBeUndefined()
    expect(getErrorResponseStack(null)).toBeUndefined()
  })

  it('builds detailed envelopes', () => {
    const error = Object.assign(new Error('nope'), { status: 409, code: 'CONFLICT' })
    expect(buildApiErrorEnvelope(error, { exposeDetails: true, requestId: 'r1' })).toEqual({
      status: 409,
      body: { message: 'nope', code: 'CONFLICT', request_id: 'r1', stack: error.stack },
    })
    expect(buildApiErrorEnvelope({ message: 'm', status: 400 }, { exposeDetails: true })).toEqual({
      status: 400,
      body: { message: 'm' },
    })
  })

  it('redacts 5xx envelopes when details are hidden', () => {
    expect(
      buildApiErrorEnvelope(new Error('secret'), { exposeDetails: false, requestId: 'r2' }),
    ).toEqual({
      status: 500,
      body: { message: 'Internal Server Error', code: 'INTERNAL_ERROR', request_id: 'r2' },
    })
    expect(
      buildApiErrorEnvelope({ status: 503 }, { exposeDetails: false, requestId: null }),
    ).toEqual({
      status: 503,
      body: { message: 'Service Unavailable', code: 'INTERNAL_ERROR' },
    })
    const clientError = Object.assign(new Error('bad'), { status: 400 })
    expect(buildApiErrorEnvelope(clientError, { exposeDetails: false })).toEqual({
      status: 400,
      body: { message: 'bad' },
    })
  })
})
