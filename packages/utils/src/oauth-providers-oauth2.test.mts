import { describe, expect, it } from 'vitest'
import { linkedinProvider, microsoftProvider } from './oauth-providers.mts'
import { NOW, failure, form, input, json, routeFetch } from './oauth-providers-test-helpers.mts'

describe('linkedinProvider', () => {
  const provider = linkedinProvider({ clientId: 'id', clientSecret: 'secret' })
  const TOKEN = 'https://www.linkedin.com/oauth/v2/accessToken'
  const INFO = 'https://api.linkedin.com/v2/userinfo'
  const routes = (overrides: Record<string, Response> = {}) =>
    routeFetch({
      [TOKEN]: json({ access_token: 'li-token', expires_in: 3600 }),
      [INFO]: json({
        sub: 'li-1',
        name: 'Lin',
        email: 'lin@example.com',
        email_verified: true,
        picture: 'https://example.com/l.png',
        given_name: 'L',
        family_name: 'K',
      }),
      ...overrides,
    })

  it('posts client credentials in the form and gates the email on email_verified', async () => {
    const { ctx, init } = routes()
    const result = await provider.redeem(input, ctx())
    expect(form(init(0))).toEqual({
      grant_type: 'authorization_code',
      code: 'auth-code',
      redirect_uri: input.redirectUri,
      client_id: 'id',
      client_secret: 'secret',
      code_verifier: 'verifier-1',
    })
    expect(result.tokens).toEqual({
      accessToken: 'li-token',
      accessTokenExpiresAt: new Date(NOW + 3_600_000),
    })
    expect(result.profile).toEqual({
      providerUserId: 'li-1',
      verifiedEmail: 'lin@example.com',
      data: {
        name: 'Lin',
        email: 'lin@example.com',
        picture: 'https://example.com/l.png',
        given_name: 'L',
        family_name: 'K',
      },
    })
  })

  it('omits the verifier when undefined and drops unverified emails', async () => {
    const { ctx, init } = routes({
      [INFO]: json({ sub: 'li-2', email: 'lin@example.com', email_verified: false }),
    })
    const result = await provider.redeem({ code: 'c', redirectUri: 'r' }, ctx())
    expect(form(init(0))).not.toHaveProperty('code_verifier')
    expect(result.profile).toEqual({
      providerUserId: 'li-2',
      verifiedEmail: null,
      data: { email: 'lin@example.com' },
    })
  })

  it('returns a null verified email when verified but no email is present', async () => {
    const { ctx } = routes({ [INFO]: json({ sub: 'li-3', email_verified: true }) })
    expect((await provider.redeem(input, ctx())).profile.verifiedEmail).toBeNull()
  })

  it('maps error bodies, a missing sub, and http failures', async () => {
    const error = await failure(
      provider.redeem(
        input,
        routes({ [TOKEN]: json({ error: 'invalid_grant', error_description: 'expired' }) }).ctx(),
      ),
    )
    expect(error).toMatchObject({ kind: 'provider_error', provider: 'linkedin' })
    expect(error.message).toContain('expired')
    expect(await failure(provider.redeem(input, routes({ [INFO]: json({}) }).ctx()))).toMatchObject(
      { kind: 'malformed' },
    )
    expect(
      await failure(provider.redeem(input, routes({ [INFO]: json({}, 401) }).ctx())),
    ).toMatchObject({ kind: 'http', status: 401 })
  })
})

describe('microsoftProvider', () => {
  const TOKEN = (tenant: string) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
  const ME = 'https://graph.microsoft.com/v1.0/me'
  const routes = (tenant: string, overrides: Record<string, Response> = {}) =>
    routeFetch({
      [TOKEN(tenant)]: json({
        access_token: 'ms-token',
        refresh_token: 'ms-refresh',
        expires_in: 3599,
      }),
      [ME]: json({
        id: 'ms-1',
        displayName: 'Mia',
        mail: 'mia@example.com',
        givenName: 'M',
        surname: 'S',
      }),
      ...overrides,
    })

  it('does not treat Graph mail as verified by default', async () => {
    const provider = microsoftProvider({ clientId: 'id', clientSecret: 'secret' })
    const result = await provider.redeem(input, routes('common').ctx())
    expect(result.profile.verifiedEmail).toBeNull()
    expect(result.profile.data).toMatchObject({ email: 'mia@example.com' })
  })

  it('defaults the tenant to common and trusts Graph mail when configured', async () => {
    const provider = microsoftProvider({
      clientId: 'id',
      clientSecret: 'secret',
      trustMailAsVerified: true,
    })
    const { ctx, init, urls } = routes('common')
    const result = await provider.redeem(input, ctx())
    expect(urls()[0]).toBe(TOKEN('common'))
    expect(form(init(0))).toMatchObject({
      client_id: 'id',
      client_secret: 'secret',
      code_verifier: 'verifier-1',
    })
    expect(result).toEqual({
      tokens: {
        accessToken: 'ms-token',
        refreshToken: 'ms-refresh',
        accessTokenExpiresAt: new Date(NOW + 3_599_000),
      },
      profile: {
        providerUserId: 'ms-1',
        verifiedEmail: 'mia@example.com',
        data: { name: 'Mia', email: 'mia@example.com', given_name: 'M', family_name: 'S' },
      },
    })
  })

  it('uses a configured tenant and tolerates a profile without mail', async () => {
    const provider = microsoftProvider({
      clientId: 'id',
      clientSecret: 'secret',
      tenantId: 'contoso',
      trustMailAsVerified: true,
    })
    const { ctx, urls } = routes('contoso', {
      [ME]: json({ id: 'ms-2', userPrincipalName: 'm@example.com' }),
    })
    const result = await provider.redeem(input, ctx())
    expect(urls()[0]).toBe(TOKEN('contoso'))
    expect(result.profile).toEqual({ providerUserId: 'ms-2', verifiedEmail: null, data: {} })
  })

  it('requires a verifier and a user id, and surfaces http failures', async () => {
    const provider = microsoftProvider({ clientId: 'id', clientSecret: 'secret', tenantId: '' })
    expect(
      await failure(provider.redeem({ code: 'c', redirectUri: 'r' }, routes('common').ctx())),
    ).toMatchObject({ kind: 'malformed', provider: 'microsoft' })
    expect(
      await failure(
        provider.redeem(input, routes('common', { [ME]: json({ mail: 'a@example.com' }) }).ctx()),
      ),
    ).toMatchObject({ kind: 'malformed' })
    expect(
      await failure(provider.redeem(input, routes('common', { [ME]: json({}, 500) }).ctx())),
    ).toMatchObject({ kind: 'http', status: 500 })
  })
})
