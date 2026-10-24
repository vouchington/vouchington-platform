import { describe, expect, it, vi } from 'vitest'
import {
  OAuthProviderError,
  asRecord,
  compact,
  formBody,
  isRecord,
  nowOf,
  parseTokens,
  requestJson,
  requireCodeVerifier,
  str,
} from './oauth-providers-core.mts'
import { NOW, failure, json, routeFetch } from './oauth-providers-test-helpers.mts'

describe('helpers', () => {
  it('reads the injected clock or falls back to Date.now', () => {
    const fetch = async () => new Response()
    expect(nowOf({ fetch, now: () => 5 })()).toBe(5)
    expect(nowOf({ fetch })).toBe(Date.now)
  })

  it('narrows records and strings', () => {
    expect(isRecord({})).toBe(true)
    expect(isRecord([])).toBe(false)
    expect(isRecord(null)).toBe(false)
    expect(str('a')).toBe('a')
    expect(str('')).toBeUndefined()
    expect(str(1)).toBeUndefined()
    expect(asRecord('p', { a: 1 }, 'x')).toEqual({ a: 1 })
    expect(() => asRecord('p', [], 'Thing')).toThrow('Thing is not an object')
  })

  it('compacts values and builds form bodies without undefined fields', () => {
    expect(compact({ a: 1, b: undefined, c: null })).toEqual({ a: 1, c: null })
    expect(formBody({ a: '1', b: undefined, c: 'x y' })).toBe('a=1&c=x+y')
  })

  it('requires a code verifier', () => {
    expect(requireCodeVerifier('p', { code: 'c', redirectUri: 'r', codeVerifier: 'v' })).toBe('v')
    expect(() => requireCodeVerifier('p', { code: 'c', redirectUri: 'r' })).toThrow(
      OAuthProviderError,
    )
  })

  it('exposes provider, kind and status on errors', () => {
    const error = new OAuthProviderError('p', 'http', 'boom', 502)
    expect(error).toMatchObject({
      name: 'OAuthProviderError',
      provider: 'p',
      kind: 'http',
      status: 502,
    })
    expect(new OAuthProviderError('p', 'malformed', 'x').status).toBeUndefined()
  })
})

describe('requestJson', () => {
  const url = 'https://api.example.com/x'

  it('passes init and the signal to fetch and returns the parsed body', async () => {
    const { fetch, ctx } = routeFetch({ [url]: json({ ok: true }) })
    const signal = new AbortController().signal
    await expect(
      requestJson('p', 'Call', ctx({ signal }), url, { method: 'POST' }),
    ).resolves.toEqual({ ok: true })
    expect(fetch).toHaveBeenCalledWith(url, { method: 'POST', redirect: 'error', signal })
  })

  it('omits the signal when none is supplied', async () => {
    const { fetch, ctx } = routeFetch({ [url]: json([]) })
    await requestJson('p', 'Call', ctx(), url)
    expect(fetch).toHaveBeenCalledWith(url, { redirect: 'error' })
  })

  it('throws http errors with the status and tolerates empty or failing bodies', async () => {
    const { ctx } = routeFetch({ [url]: json({}, 503) })
    const error = await failure(requestJson('p', 'Call', ctx(), url))
    expect(error).toMatchObject({ kind: 'http', status: 503, message: 'Call failed: 503' })
    const empty = { fetch: async () => new Response(null, { status: 500 }) }
    expect((await failure(requestJson('p', 'Call', empty, url))).status).toBe(500)
    const cancel = vi.fn(() => Promise.reject(new Error('cancel failed')))
    const odd = { ok: false, status: 502, body: { cancel } } as unknown as Response
    const stub = { ctx: () => ({ fetch: async () => odd }) }
    expect((await failure(requestJson('p', 'Call', stub.ctx(), url))).status).toBe(502)
    expect(cancel).toHaveBeenCalled()
  })

  it('throws malformed for invalid JSON', async () => {
    const { ctx } = routeFetch({ [url]: new Response('nope') })
    expect((await failure(requestJson('p', 'Call', ctx(), url))).kind).toBe('malformed')
  })
})

describe('parseTokens', () => {
  const now = () => NOW

  it('parses access, refresh and expiry', () => {
    expect(
      parseTokens('p', { access_token: 'a', refresh_token: 'r', expires_in: 60 }, now),
    ).toEqual({ accessToken: 'a', refreshToken: 'r', accessTokenExpiresAt: new Date(NOW + 60_000) })
  })

  it('omits absent or unusable optional fields', () => {
    expect(parseTokens('p', { access_token: 'a', expires_in: 0, refresh_token: '' }, now)).toEqual({
      accessToken: 'a',
    })
    expect(parseTokens('p', { access_token: 'a', expires_in: '60' }, now)).toEqual({
      accessToken: 'a',
    })
  })

  it('maps error bodies to provider errors', () => {
    const message = (payload: unknown) => {
      try {
        parseTokens('p', payload, now)
      } catch (error) {
        expect(error).toMatchObject({ kind: 'provider_error' })
        return (error as Error).message
      }
      throw new Error('expected failure')
    }
    expect(message({ error: 'bad_code' })).toBe('Token exchange failed: bad_code')
    expect(message({ error: 'bad_code', error_description: 'Code expired' })).toBe(
      'Token exchange failed: Code expired',
    )
    expect(message({ error: { message: 'Invalid code', code: 100 } })).toBe(
      'Token exchange failed: Invalid code',
    )
    expect(message({ error: { code: 100 } })).toBe('Token exchange failed: Unknown error')
    expect(message({ error: 5 })).toBe('Token exchange failed: Unknown error')
  })

  it('rejects non-objects and a missing access token', () => {
    expect(() => parseTokens('p', null, now)).toThrow('Token response is not an object')
    expect(() => parseTokens('p', { access_token: '' }, now)).toThrow('missing access_token')
  })
})
