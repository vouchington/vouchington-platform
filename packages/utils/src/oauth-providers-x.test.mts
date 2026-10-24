import { describe, expect, it } from 'vitest'
import { xProvider } from './oauth-providers.mts'
import { NOW, failure, form, input, json, routeFetch } from './oauth-providers-test-helpers.mts'

describe('xProvider', () => {
  const provider = xProvider({ clientId: 'id', clientSecret: 'secret' })
  const TOKEN = 'https://api.x.com/2/oauth2/token'
  const ME = 'https://api.x.com/2/users/me'
  const routes = (overrides: Record<string, Response> = {}) =>
    routeFetch({
      [TOKEN]: json({ access_token: 'x-token', refresh_token: 'x-refresh', expires_in: 7200 }),
      [ME]: json({
        data: {
          id: '9',
          name: 'Xavier',
          username: 'xav',
          profile_image_url: 'https://example.com/x.png',
        },
      }),
      ...overrides,
    })

  it('uses Basic auth and PKCE and never reports a verified email', async () => {
    const { ctx, init, urls } = routes()
    const result = await provider.redeem(input, ctx())
    expect(init(0).headers).toEqual({
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: `Basic ${btoa('id:secret')}`,
    })
    expect(form(init(0))).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code',
      redirect_uri: input.redirectUri,
      code_verifier: 'verifier-1',
    })
    expect(urls()[1]).toBe(`${ME}?user.fields=profile_image_url`)
    expect(init(1)).toEqual({ headers: { Authorization: 'Bearer x-token' } })
    expect(result).toEqual({
      tokens: {
        accessToken: 'x-token',
        refreshToken: 'x-refresh',
        accessTokenExpiresAt: new Date(NOW + 7_200_000),
      },
      profile: {
        providerUserId: '9',
        verifiedEmail: null,
        data: { name: 'Xavier', username: 'xav', profile_image_url: 'https://example.com/x.png' },
      },
    })
  })

  it('omits a missing profile image', async () => {
    const { ctx } = routes({ [ME]: json({ data: { id: '9', name: 'X', username: 'x' } }) })
    expect((await provider.redeem(input, ctx())).profile.data).toEqual({ name: 'X', username: 'x' })
  })

  it('requires a verifier and a user id, and surfaces http errors', async () => {
    expect(
      await failure(provider.redeem({ code: 'c', redirectUri: 'r' }, routes().ctx())),
    ).toMatchObject({ kind: 'malformed', provider: 'x' })
    expect(
      await failure(provider.redeem(input, routes({ [ME]: json({ data: { name: 'n' } }) }).ctx())),
    ).toMatchObject({ kind: 'malformed' })
    expect(await failure(provider.redeem(input, routes({ [ME]: json({}) }).ctx()))).toMatchObject({
      kind: 'malformed',
    })
    expect(
      await failure(provider.redeem(input, routes({ [ME]: json({}, 429) }).ctx())),
    ).toMatchObject({ kind: 'http', status: 429 })
  })
})
