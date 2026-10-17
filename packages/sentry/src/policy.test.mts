import type { ErrorEvent, EventHint } from '@sentry/core'
import { describe, expect, it } from 'vitest'
import { CLIENT_IP_HEADER_NAMES, createDataCollectionPolicy } from './data-collection.mts'
import { createEventFilter } from './event-filter.mts'

const event = (tags?: Record<string, unknown>) => ({ tags }) as unknown as ErrorEvent
const hint = (originalException: unknown) => ({ originalException }) as EventHint

describe('createDataCollectionPolicy', () => {
  it('collects the least data and denies IP and injected credential headers', () => {
    const policy = createDataCollectionPolicy({ credentialHeaders: ['authorization', 'x-real-ip'] })
    expect(policy).toMatchObject({
      userInfo: false,
      cookies: false,
      httpBodies: [],
      urlQueryParams: false,
      genAI: { inputs: false, outputs: false },
    })
    const deny = (policy.httpHeaders as { request: { deny: string[] } }).request.deny
    expect(deny).toEqual([...CLIENT_IP_HEADER_NAMES, 'authorization'])
    expect(policy.httpHeaders).toMatchObject({ response: { deny } })
    expect(policy).toMatchObject({ frameContextLines: 0 })
  })

  it('defaults to client IP headers and returns fresh arrays', () => {
    const first = createDataCollectionPolicy()
    const second = createDataCollectionPolicy()
    expect(first.httpHeaders).toMatchObject({ request: { deny: [...CLIENT_IP_HEADER_NAMES] } })
    expect(first.httpHeaders).not.toBe(second.httpHeaders)
  })
})

describe('createEventFilter', () => {
  const filter = createEventFilter({ isExpected: (error) => error === 'expected' })

  it('drops suppressed and expected events', () => {
    expect(filter(event({ suppressLogging: true }), hint(new Error('x')))).toBeNull()
    expect(filter(event(), hint('expected'))).toBeNull()
  })

  it('keeps events without an object exception', () => {
    const kept = event()
    expect(filter(kept, hint(undefined))).toBe(kept)
    expect(filter(kept, hint(null))).toBe(kept)
    expect(filter(kept, hint('text'))).toBe(kept)
  })

  it('drops noise messages, client errors, and connection codes', () => {
    expect(filter(event(), hint(new Error('Premature close')))).toBeNull()
    expect(filter(event(), hint({ status: 404 }))).toBeNull()
    expect(filter(event(), hint({ statusCode: 400 }))).toBeNull()
    expect(filter(event(), hint({ code: 'ECONNRESET' }))).toBeNull()
    expect(filter(event(), hint({ code: 'EPIPE' }))).toBeNull()
  })

  it('keeps server errors and unrecognized codes', () => {
    const kept = event()
    expect(filter(kept, hint({ status: 500 }))).toBe(kept)
    expect(filter(kept, hint({ statusCode: 502, message: 'bad' }))).toBe(kept)
    expect(filter(kept, hint({ code: 'EOTHER', message: 4 }))).toBe(kept)
    expect(filter(kept, hint({ code: 4 }))).toBe(kept)
  })

  it('honors overrides', () => {
    const custom = createEventFilter({
      minimumStatus: 400,
      ignoredCodes: ['X'],
      ignoredMessages: [],
    })
    const kept = event()
    expect(custom(kept, hint({ status: 400 }))).toBe(kept)
    expect(custom(kept, hint({ code: 'ECONNRESET' }))).toBe(kept)
    expect(custom(kept, hint({ code: 'X' }))).toBeNull()
    expect(custom(kept, hint(new Error('Premature close')))).toBe(kept)
  })
})
