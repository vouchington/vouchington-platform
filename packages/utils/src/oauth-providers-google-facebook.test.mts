import { describe, expect, it } from 'vitest'
import { facebookProvider, googleProvider } from './oauth-providers.mts'
import { NOW, failure, form, input, json, routeFetch } from './oauth-providers-test-helpers.mts'

describe('googleProvider', () => {
  const provider = googleProvider({ clientId: 'id', clientSecret: 'secret' })
  const TOKEN = 'https://oauth2.googleapis.com/token'
  const INFO = 'https://openidconnect.googleapis.com/v1/userinfo'
  const routes = (overrides: Record<string, Response> = {}) =>
    routeFetch({
      [TOKEN]: json({ access_token: 'g-token', expires_in: 3599 }),
      [INFO]: json({
        sub: 'g-1',
        name: 'Gia',
        email: 'gia@example.com',
        email_verified: true,
        picture: 'https://example.com/g.png',
        given_name: 'G',
        family_name: 'H',
      }),
      ...overrides,
    })

  it('exchanges the code with PKCE and keys the profile by sub', async () => {
    const { ctx, init, urls } = routes()
    const signal = new AbortController().signal
    const result = await provider.redeem(input, ctx({ signal }))
    expect(urls()).toEqual([TOKEN, INFO])
    expect(init(0)).toMatchObject({
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal,
    })
    expect(form(init(0))).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code',
      redirect_uri: input.redirectUri,
      client_id: 'id',
      client_secret: 'secret',
      code_verifier: 'verifier-1',
    })
    expect(init(1)).toMatchObject({ headers: { Authorization: 'Bearer g-token' }, signal })
    expect(result).toEqual({
      tokens: { accessToken: 'g-token', accessTokenExpiresAt: new Date(NOW + 3_599_000) },
      profile: {
        providerUserId: 'g-1',
        verifiedEmail: 'gia@example.com',
        data: {
          name: 'Gia',
          email: 'gia@example.com',
          picture: 'https://example.com/g.png',
          given_name: 'G',
          family_name: 'H',
        },
      },
    })
  })

  it('only trusts an email when email_verified is exactly true', async () => {
    for (const email_verified of [false, 'true', undefined]) {
      const { ctx } = routes({ [INFO]: json({ sub: 'g', email: 'a@example.com', email_verified }) })
      expect((await provider.redeem(input, ctx())).profile.verifiedEmail).toBeNull()
    }
    const { ctx } = routes({ [INFO]: json({ sub: 'g', email_verified: true }) })
    expect((await provider.redeem(input, ctx())).profile).toMatchObject({
      verifiedEmail: null,
      data: {},
    })
  })

  it('requires a verifier, an access token, and a sub', async () => {
    expect(
      await failure(provider.redeem({ code: 'c', redirectUri: 'r' }, routes().ctx())),
    ).toMatchObject({ kind: 'malformed', provider: 'google' })
    expect(
      await failure(provider.redeem(input, routes({ [TOKEN]: json({}) }).ctx())),
    ).toMatchObject({ kind: 'malformed' })
    expect(
      await failure(
        provider.redeem(input, routes({ [INFO]: json({ email: 'a@example.com' }) }).ctx()),
      ),
    ).toMatchObject({ kind: 'malformed' })
  })

  it('maps error bodies and http failures', async () => {
    const providerError = await failure(
      provider.redeem(input, routes({ [TOKEN]: json({ error: 'invalid_grant' }) }).ctx()),
    )
    expect(providerError).toMatchObject({ kind: 'provider_error', provider: 'google' })
    expect(
      await failure(provider.redeem(input, routes({ [TOKEN]: json({}, 400) }).ctx())),
    ).toMatchObject({ kind: 'http', status: 400 })
    expect(
      await failure(provider.redeem(input, routes({ [INFO]: json({}, 401) }).ctx())),
    ).toMatchObject({ kind: 'http', status: 401 })
  })
})

describe('facebookProvider', () => {
  const provider = facebookProvider({ appId: 'app', appSecret: 'secret', graphVersion: 'v1.0' })
  const OAUTH = 'https://graph.facebook.com/v1.0/oauth/access_token'
  const ME = 'https://graph.facebook.com/v1.0/me'

  function routes(overrides: { exchange?: Response[]; me?: Response } = {}) {
    const exchange = [
      ...(overrides.exchange ?? [
        json({ access_token: 'short', token_type: 'bearer' }),
        json({ access_token: 'long', expires_in: 5_184_000 }),
      ]),
    ]
    return routeFetch({
      [OAUTH]: () => exchange.shift()!,
      [ME]: overrides.me ?? json({ id: 'fb-1', name: 'Fay', email: 'fay@example.com' }),
    })
  }

  it('exchanges the code, upgrades to a long-lived token, and stores the whole /me', async () => {
    const { ctx, init, urls } = routes()
    const result = await provider.redeem(input, ctx())
    expect(urls()).toEqual([OAUTH, OAUTH, `${ME}?fields=name,email`])
    expect(form(init(0))).toEqual({
      client_id: 'app',
      client_secret: 'secret',
      redirect_uri: input.redirectUri,
      code: 'auth-code',
    })
    expect(form(init(1))).toEqual({
      client_id: 'app',
      client_secret: 'secret',
      grant_type: 'fb_exchange_token',
      fb_exchange_token: 'short',
    })
    expect(init(2)).toEqual({ headers: { Authorization: 'Bearer long' } })
    expect(result).toEqual({
      tokens: { accessToken: 'long', accessTokenExpiresAt: new Date(NOW + 5_184_000_000) },
      profile: {
        providerUserId: 'fb-1',
        verifiedEmail: 'fay@example.com',
        data: { id: 'fb-1', name: 'Fay', email: 'fay@example.com' },
      },
    })
  })

  it('returns a null verified email when /me has none', async () => {
    const { ctx } = routes({ me: json({ id: 'fb-2', name: 'No Mail' }) })
    expect((await provider.redeem(input, ctx())).profile.verifiedEmail).toBeNull()
  })

  it('maps Graph error objects from either exchange', async () => {
    const graphError = () => json({ error: { message: 'Invalid verification code', code: 100 } })
    const first = await failure(provider.redeem(input, routes({ exchange: [graphError()] }).ctx()))
    expect(first).toMatchObject({ kind: 'provider_error', provider: 'facebook' })
    expect(first.message).toContain('Invalid verification code')
    const second = await failure(
      provider.redeem(
        input,
        routes({ exchange: [json({ access_token: 'short' }), graphError()] }).ctx(),
      ),
    )
    expect(second.kind).toBe('provider_error')
  })

  it('surfaces http failures and a missing id', async () => {
    expect(
      await failure(provider.redeem(input, routes({ exchange: [json({}, 500)] }).ctx())),
    ).toMatchObject({ kind: 'http', status: 500 })
    expect(
      await failure(provider.redeem(input, routes({ me: json({}, 403) }).ctx())),
    ).toMatchObject({ kind: 'http', status: 403 })
    expect(
      await failure(provider.redeem(input, routes({ me: json({ name: 'No id' }) }).ctx())),
    ).toMatchObject({ kind: 'malformed' })
  })
})
