import { describe, expect, it } from 'vitest'
import { lookupWebRiskUri, WEB_RISK_THREAT_TYPES } from './web-risk.mts'
import { fakeFetch, jsonResponse } from './provider-http-test-helpers.mts'

async function lookup(body: unknown, extra: { threatTypes?: string[]; endpoint?: string } = {}) {
  const { fetch, calls } = fakeFetch(() => jsonResponse(body))
  const result = await lookupWebRiskUri({
    fetch,
    apiKey: 'key',
    uri: 'https://a.test/x?y=1',
    ...extra,
  })
  return { result, calls }
}

describe('lookupWebRiskUri', () => {
  it('sends a GET with uri, key, and every default threat type', async () => {
    const { result, calls } = await lookup({})
    expect(result).toEqual({ status: 'clean' })
    expect(calls[0]!.init.method).toBe('GET')
    const url = new URL(calls[0]!.input)
    expect(url.origin + url.pathname).toBe('https://webrisk.googleapis.com/v1/uris:search')
    expect(url.searchParams.get('uri')).toBe('https://a.test/x?y=1')
    expect(url.searchParams.get('key')).toBe('key')
    expect(url.searchParams.getAll('threatTypes')).toEqual([...WEB_RISK_THREAT_TYPES])
  })

  it('honors custom threat types and endpoint, and treats a null threat as clean', async () => {
    const { result, calls } = await lookup(
      { threat: null },
      { threatTypes: ['MALWARE'], endpoint: 'https://example.test/search' },
    )
    expect(result).toEqual({ status: 'clean' })
    const url = new URL(calls[0]!.input)
    expect(url.host).toBe('example.test')
    expect(url.searchParams.getAll('threatTypes')).toEqual(['MALWARE'])
  })

  it('returns threat types and expiry', async () => {
    expect(
      (await lookup({ threat: { threatTypes: ['MALWARE'], expireTime: '2026-01-01T00:00:00Z' } }))
        .result,
    ).toEqual({ status: 'threat', threatTypes: ['MALWARE'], expireTime: '2026-01-01T00:00:00Z' })
    expect((await lookup({ threat: { threatTypes: ['MALWARE'] } })).result).toMatchObject({
      expireTime: null,
    })
  })

  it('reports malformed bodies as non-retryable errors', async () => {
    for (const body of [
      [],
      'x',
      { threat: 'x' },
      { threat: {} },
      { threat: { threatTypes: [] } },
      { threat: { threatTypes: [1] } },
    ]) {
      expect((await lookup(body)).result).toMatchObject({
        status: 'error',
        failure: { kind: 'malformed-response', retryable: false },
      })
    }
  })

  it('treats 403 and 429 as rate limits by default, and 5xx as retryable', async () => {
    for (const status of [403, 429]) {
      const { fetch } = fakeFetch(
        () => new Response(null, { status, headers: { 'retry-after': '9' } }),
      )
      expect(await lookupWebRiskUri({ fetch, apiKey: 'k', uri: 'https://a.test' })).toMatchObject({
        status: 'error',
        failure: { kind: 'rate-limited', status, retryAfterMs: 9000 },
      })
    }
    const down = fakeFetch(() => new Response(null, { status: 503 }))
    expect(await lookupWebRiskUri({ fetch: down.fetch, apiKey: 'k', uri: 'u:' })).toMatchObject({
      failure: { kind: 'http', retryable: true },
    })
  })

  it('lets callers narrow rate-limit statuses', async () => {
    const { fetch } = fakeFetch(() => new Response(null, { status: 403 }))
    expect(
      await lookupWebRiskUri({
        fetch,
        apiKey: 'k',
        uri: 'https://a.test',
        rateLimitStatuses: [429],
      }),
    ).toMatchObject({ failure: { kind: 'http', retryable: false } })
  })
})
