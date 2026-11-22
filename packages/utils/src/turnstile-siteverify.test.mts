import { describe, expect, it } from 'vitest'
import {
  extractTurnstileToken,
  findTurnstileContextMismatches,
  TURNSTILE_SITEVERIFY_URL,
  TURNSTILE_TEST_SECRET_KEYS,
  verifyTurnstileToken,
} from './turnstile-siteverify.mts'
import { fakeFetch, jsonResponse } from './provider-http-test-helpers.mts'

async function verify(body: unknown, extra: Record<string, string> = {}) {
  const { fetch, calls } = fakeFetch(() => jsonResponse(body))
  const result = await verifyTurnstileToken({ fetch, secret: 's', token: 't', ...extra })
  return { result, calls }
}

describe('verifyTurnstileToken', () => {
  it('posts a form body and returns the verdict', async () => {
    const { result, calls } = await verify(
      {
        success: true,
        hostname: 'Example.com',
        action: 'login',
        cdata: 'c',
        challenge_ts: '2026-01-01T00:00:00Z',
        metadata: { result_with_testing_key: true },
      },
      { remoteIp: '203.0.113.1', idempotencyKey: 'k' },
    )
    expect(result).toEqual({
      status: 'success',
      hostname: 'Example.com',
      action: 'login',
      cdata: 'c',
      challengeTs: '2026-01-01T00:00:00Z',
      resultWithTestingKey: true,
    })
    expect(calls[0]?.input).toBe(TURNSTILE_SITEVERIFY_URL)
    expect(calls[0]?.init.method).toBe('POST')
    const sent = new URLSearchParams(calls[0]?.init.body)
    expect(Object.fromEntries(sent)).toEqual({
      secret: 's',
      response: 't',
      remoteip: '203.0.113.1',
      idempotency_key: 'k',
    })
  })

  it('returns null context for sparse verdicts and honors a custom endpoint', async () => {
    const { fetch, calls } = fakeFetch(() => jsonResponse({ success: true }))
    const result = await verifyTurnstileToken({
      fetch,
      secret: 's',
      token: 't',
      endpoint: 'https://example.test/verify',
    })
    expect(result).toEqual({
      status: 'success',
      hostname: null,
      action: null,
      cdata: null,
      challengeTs: null,
      resultWithTestingKey: false,
    })
    expect(calls[0]?.input).toBe('https://example.test/verify')
    expect(new URLSearchParams(calls[0]?.init.body).has('remoteip')).toBe(false)
  })

  it.each([
    ['missing-input-response', 'missing-token'],
    ['invalid-input-response', 'invalid-token'],
    ['timeout-or-duplicate', 'expired-or-duplicate'],
  ])('rejects %s as %s', async (code, reason) => {
    const { result } = await verify({ success: false, 'error-codes': [code] })
    expect(result).toEqual({ status: 'rejected', reason, errorCodes: [code] })
  })

  it('rejects unclassified failures, with or without codes', async () => {
    expect((await verify({ success: false, 'error-codes': ['novel', 3] })).result).toEqual({
      status: 'rejected',
      reason: 'unclassified',
      errorCodes: ['novel'],
    })
    expect((await verify({ success: false })).result).toMatchObject({
      status: 'rejected',
      reason: 'unclassified',
      errorCodes: [],
    })
  })

  it.each(['missing-input-secret', 'invalid-input-secret', 'bad-request'])(
    'treats %s as a non-retryable configuration error',
    async (code) => {
      const { result } = await verify({ success: false, 'error-codes': [code] })
      expect(result).toMatchObject({
        status: 'error',
        errorCodes: [code],
        failure: { kind: 'configuration', retryable: false },
      })
    },
  )

  it('treats internal-error as retryable', async () => {
    const { result } = await verify({ success: false, 'error-codes': ['internal-error'] })
    expect(result).toMatchObject({ status: 'error', failure: { retryable: true } })
  })

  it('reports malformed bodies and transport failures as errors', async () => {
    for (const body of [null, [], { success: 'yes' }]) {
      expect((await verify(body)).result).toMatchObject({
        status: 'error',
        failure: { kind: 'malformed-response', retryable: false },
      })
    }
    const { fetch } = fakeFetch(() => new Response('x', { status: 502 }))
    expect(await verifyTurnstileToken({ fetch, secret: 's', token: 't' })).toMatchObject({
      status: 'error',
      errorCodes: [],
      failure: { kind: 'http', retryable: true, status: 502 },
    })
  })
})

describe('findTurnstileContextMismatches', () => {
  const verdict = { action: 'login', hostname: 'Example.com' }

  it('matches exactly on action and case-insensitively on hostname', () => {
    expect(findTurnstileContextMismatches(verdict, {})).toEqual([])
    expect(
      findTurnstileContextMismatches(verdict, { action: 'login', hostname: 'example.COM' }),
    ).toEqual([])
  })

  it('reports each mismatch', () => {
    expect(
      findTurnstileContextMismatches(
        { action: null, hostname: null },
        { action: 'login', hostname: 'a.test' },
      ),
    ).toEqual([
      { field: 'action', expected: 'login', received: null },
      { field: 'hostname', expected: 'a.test', received: null },
    ])
  })
})

describe('extractTurnstileToken', () => {
  it('returns the first non-empty trimmed field', () => {
    expect(extractTurnstileToken({ cf_turnstile_response: ' tok ' })).toBe('tok')
    expect(extractTurnstileToken({ a: '  ', b: 'x', c: 'y' }, ['a', 'b', 'c'])).toBe('x')
    expect(extractTurnstileToken({ a: 1 }, ['a'])).toBeUndefined()
    expect(extractTurnstileToken('nope')).toBeUndefined()
    expect(extractTurnstileToken(null)).toBeUndefined()
  })
})

describe('TURNSTILE_TEST_SECRET_KEYS', () => {
  it('lists the documented secrets', () => {
    expect(Object.values(TURNSTILE_TEST_SECRET_KEYS)).toHaveLength(3)
  })
})
