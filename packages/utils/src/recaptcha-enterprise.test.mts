import { describe, expect, it } from 'vitest'
import { assessRecaptchaToken } from './recaptcha-enterprise.mts'
import { fakeFetch, jsonResponse } from './provider-http-test-helpers.mts'

const base = {
  projectId: 'proj/1',
  apiKey: 'k&1',
  siteKey: 'site',
  token: 'tok',
  expectedAction: 'a',
}

async function assess(body: unknown, extra: { userIpAddress?: string; origin?: string } = {}) {
  const { fetch, calls } = fakeFetch(() => jsonResponse(body))
  const result = await assessRecaptchaToken({ ...base, fetch, ...extra })
  return { result, calls }
}

describe('assessRecaptchaToken', () => {
  it('builds the request and returns a scored assessment', async () => {
    const { result, calls } = await assess(
      {
        tokenProperties: { valid: true, action: 'a' },
        riskAnalysis: { score: 0.3, reasons: ['AUTOMATION', 1] },
      },
      { userIpAddress: '203.0.113.1' },
    )
    expect(result).toEqual({
      status: 'assessed',
      score: 0.3,
      action: 'a',
      actionMatches: true,
      reasons: ['AUTOMATION'],
    })
    const url = new URL(calls[0]!.input)
    expect(url.origin).toBe('https://recaptchaenterprise.googleapis.com')
    expect(url.pathname).toBe('/v1/projects/proj%2F1/assessments')
    expect(url.searchParams.get('key')).toBe('k&1')
    expect(JSON.parse(calls[0]!.init.body!)).toEqual({
      event: { token: 'tok', siteKey: 'site', expectedAction: 'a', userIpAddress: '203.0.113.1' },
    })
  })

  it('flags action mismatches, defaults reasons, and honors a custom origin', async () => {
    const { result, calls } = await assess(
      { tokenProperties: { valid: true }, riskAnalysis: { score: 0.9 } },
      { origin: 'https://example.test' },
    )
    expect(result).toEqual({
      status: 'assessed',
      score: 0.9,
      action: null,
      actionMatches: false,
      reasons: [],
    })
    expect(calls[0]!.input.startsWith('https://example.test/')).toBe(true)
    expect(JSON.parse(calls[0]!.init.body!).event).not.toHaveProperty('userIpAddress')
  })

  it('classifies invalid tokens with a typed reason', async () => {
    expect(
      (await assess({ tokenProperties: { valid: false, invalidReason: 'EXPIRED', action: 'a' } }))
        .result,
    ).toEqual({ status: 'invalid-token', invalidReason: 'EXPIRED', action: 'a' })
    expect(
      (await assess({ tokenProperties: { valid: false, invalidReason: 'NEW' } })).result,
    ).toEqual({ status: 'invalid-token', invalidReason: 'UNKNOWN', action: null })
    expect((await assess({ tokenProperties: { valid: false } })).result).toMatchObject({
      invalidReason: 'UNKNOWN',
    })
  })

  it('reports malformed bodies as non-retryable errors', async () => {
    for (const body of [null, {}, { tokenProperties: { valid: 'yes' } }]) {
      expect((await assess(body)).result).toMatchObject({
        status: 'error',
        failure: { kind: 'malformed-response', retryable: false },
      })
    }
    for (const risk of [undefined, {}, { score: '0.5' }]) {
      expect(
        (await assess({ tokenProperties: { valid: true }, riskAnalysis: risk })).result,
      ).toMatchObject({ status: 'error', failure: { kind: 'malformed-response' } })
    }
  })

  it('surfaces rate limits and HTTP errors without the request URL', async () => {
    const limited = fakeFetch(() => new Response(null, { status: 429 }))
    const result = await assessRecaptchaToken({ ...base, fetch: limited.fetch })
    expect(result).toMatchObject({
      status: 'error',
      failure: { kind: 'rate-limited', retryable: true, status: 429 },
    })
    expect(JSON.stringify(result)).not.toContain('k&1')
    const broken = fakeFetch(() => new Response(null, { status: 400 }))
    expect(await assessRecaptchaToken({ ...base, fetch: broken.fetch })).toMatchObject({
      failure: { kind: 'http', retryable: false },
    })
  })
})
