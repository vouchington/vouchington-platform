import { describe, expect, it } from 'vitest'
import { scrubJobData } from './job-data-scrub.mts'

describe('scrubJobData', () => {
  it('returns undefined for missing, non-object, array, or empty payloads', () => {
    expect(scrubJobData(undefined)).toBeUndefined()
    expect(scrubJobData(null)).toBeUndefined()
    expect(scrubJobData('a string')).toBeUndefined()
    expect(scrubJobData(['not-an-object'])).toBeUndefined()
    expect(scrubJobData({})).toBeUndefined()
  })

  it('redacts PII/secret-shaped keys regardless of value shape', () => {
    expect(
      scrubJobData(
        {
          emailAddress: 'person@example.test',
          email_address: 'person@example.test',
          token: 'login-token',
          code: 'a3f9c2e1',
          password: 'hunter2',
          physicalAddress: '123 Main St',
          ipAddress: '203.0.113.5',
          phone_number: '+15551234567',
          session_id: 'abc123',
          contactName: 'Jane Doe',
        },
        { sensitiveNames: ['code', 'contactname'] },
      ),
    ).toEqual({
      code: '[Filtered]',
      contactName: '[Filtered]',
      email_address: '[Filtered]',
      emailAddress: '[Filtered]',
      ipAddress: '[Filtered]',
      password: '[Filtered]',
      phone_number: '[Filtered]',
      physicalAddress: '[Filtered]',
      session_id: '[Filtered]',
      token: '[Filtered]',
    })
  })

  it('keeps safe scalars: booleans, numbers, uuids, ulids, and short enum-like strings', () => {
    expect(
      scrubJobData({
        active: true,
        retries: 3,
        userId: '11111111-1111-4111-8111-111111111111',
        requestId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        status: 'processing',
        provider: 'us-west-2',
      }),
    ).toEqual({
      active: true,
      provider: 'us-west-2',
      requestId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      retries: 3,
      status: 'processing',
      userId: '11111111-1111-4111-8111-111111111111',
    })
  })

  it('redacts free-text/unstructured string values by default', () => {
    expect(
      scrubJobData({ subject: 'Welcome aboard!', bodyHtml: '<p>Hi there</p>', note: 'free text' }),
    ).toEqual({ bodyHtml: '[Filtered]', note: '[Filtered]', subject: '[Filtered]' })
  })

  it('preserves null and undefined leaf values', () => {
    expect(scrubJobData({ optional: null, missing: undefined, kept: 'ok' })).toEqual({
      kept: 'ok',
      missing: undefined,
      optional: null,
    })
  })

  it('keeps an own __proto__ key as data without touching the prototype', () => {
    const scrubbed = scrubJobData(JSON.parse('{"__proto__":{"admin":true},"status":"ok"}'))!

    expect(Object.getPrototypeOf(scrubbed)).toBe(Object.prototype)
    expect((scrubbed as { admin?: boolean }).admin).toBeUndefined()
    expect(Object.keys(scrubbed)).toEqual(['__proto__', 'status'])
  })

  it('redacts unsupported value types', () => {
    expect(scrubJobData({ big: 10n, fn: () => 1 })).toEqual({
      big: '[Filtered]',
      fn: '[Filtered]',
    })
  })

  it('recurses into nested objects and arrays, scrubbing PII at every depth', () => {
    expect(
      scrubJobData({
        recipient: { emailAddress: 'person@example.test', userId: 'user-123' },
        items: [{ token: 'abc' }, { status: 'ok' }],
      }),
    ).toEqual({
      items: [{ token: '[Filtered]' }, { status: 'ok' }],
      recipient: { emailAddress: '[Filtered]', userId: 'user-123' },
    })
  })

  it('caps object keys at 32, sorted, and arrays at 10 items with a remainder marker', () => {
    const manyKeys = Object.fromEntries(Array.from({ length: 40 }, (_, i) => [`k${i}`, i]))
    const scrubbed = scrubJobData(manyKeys) as Record<string, unknown>
    expect(Object.keys(scrubbed)).toEqual(Object.keys(manyKeys).toSorted().slice(0, 32))

    expect(scrubJobData({ items: Array.from({ length: 15 }, (_, i) => i) })).toEqual({
      items: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, '...5 more'],
    })
  })

  it('redacts containers nested past the max depth instead of recursing indefinitely', () => {
    expect(scrubJobData({ a: { b: { c: { d: { e: 'status' } } } } })).toEqual({
      a: { b: { c: { d: '[Filtered]' } } },
    })
    expect(scrubJobData({ a: { b: { c: { d: [1] } } } })).toEqual({
      a: { b: { c: { d: '[Filtered]' } } },
    })
  })

  it('matches exact names only exactly and lets options override every default', () => {
    expect(
      scrubJobData({ zipcode: 'zip', code: 'a3f9c2e1' }, { sensitiveNames: ['code'] }),
    ).toEqual({ code: '[Filtered]', zipcode: 'zip' })
    expect(
      scrubJobData(
        { email: 'a', secretish: 'b', nested: { list: [1, 2, 3], deep: { x: { z: 1 } } } },
        {
          redacted: '***',
          sensitiveSubstrings: ['secret'],
          maxDepth: 3,
          maxArrayItems: 2,
          maxKeys: 3,
        },
      ),
    ).toEqual({
      email: 'a',
      nested: { deep: { x: '***' }, list: [1, 2, '...1 more'] },
      secretish: '***',
    })
  })
})
