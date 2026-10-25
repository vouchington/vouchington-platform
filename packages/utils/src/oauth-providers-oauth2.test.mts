import { describe, expect, it } from 'vitest'
import { linkedinProvider, microsoftProvider } from './oauth-providers.mts'
import { NOW, failure, form, input, json, routeFetch } from './oauth-providers-test-helpers.mts'
import { makeKey, signToken } from './oidc-id-token-test-helpers.mts'

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
  const TID = '11111111-2222-3333-4444-555555555555'
  const OTHER = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee'
  const TOKEN = (tenant: string) => `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`
  const KEYS = (tenant: string) => `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`
  const ME = 'https://graph.microsoft.com/v1.0/me'
  const key = makeKey('microsoft-key')
  const claims = (overrides: Record<string, unknown> = {}) => ({
    iss: `https://login.microsoftonline.com/${TID}/v2.0`,
    aud: 'id',
    sub: 'subject',
    oid: 'ms-1',
    tid: TID,
    iat: NOW / 1000,
    exp: NOW / 1000 + 600,
    email: 'signed@example.com',
    xms_edov: true,
    ...overrides,
  })
  const routes = (
    tenant: string,
    overrides: { token?: Record<string, unknown>; me?: Response; keyIssuer?: string } = {},
  ) =>
    routeFetch({
      [TOKEN(tenant)]: json({
        access_token: 'ms-token',
        refresh_token: 'ms-refresh',
        expires_in: 3599,
        id_token: signToken(key, claims()),
        ...overrides.token,
      }),
      [KEYS(tenant)]: json({ keys: [{ ...key.jwk, issuer: overrides.keyIssuer }] }),
      [ME]:
        overrides.me ??
        json({
          id: 'ms-1',
          displayName: 'Mia',
          mail: 'graph@example.com',
          givenName: 'M',
          surname: 'S',
        }),
    })
  const provider = (tenantId?: string) =>
    microsoftProvider({ clientId: 'id', clientSecret: 'secret', ...(tenantId ? { tenantId } : {}) })

  it('requests OIDC scopes and uses only a signed, domain-verified email', async () => {
    const { ctx, init, urls } = routes('common')
    const result = await provider().redeem(input, ctx())
    expect(urls()).toEqual([TOKEN('common'), KEYS('common'), ME])
    expect(form(init(0))).toMatchObject({
      client_id: 'id',
      client_secret: 'secret',
      code_verifier: 'verifier-1',
      scope: 'openid email User.Read',
    })
    expect(result).toEqual({
      tokens: {
        accessToken: 'ms-token',
        refreshToken: 'ms-refresh',
        accessTokenExpiresAt: new Date(NOW + 3_599_000),
      },
      profile: {
        providerUserId: 'ms-1',
        verifiedEmail: 'signed@example.com',
        data: { name: 'Mia', email: 'graph@example.com', given_name: 'M', family_name: 'S' },
      },
    })
  })

  it.each([false, undefined, 'true'])(
    'leaves email unverified for xms_edov=%s',
    async (xms_edov) => {
      const { ctx } = routes('organizations', {
        token: { id_token: signToken(key, claims({ xms_edov })) },
      })
      const result = await provider('organizations').redeem(input, ctx())
      expect(result.profile.verifiedEmail).toBeNull()
      expect(result.profile.data.email).toBe('graph@example.com')
    },
  )

  it('keeps verified email null if the signed claim has no email', async () => {
    const { ctx } = routes('common', {
      token: { id_token: signToken(key, claims({ email: undefined })) },
    })
    expect((await provider().redeem(input, ctx())).profile.verifiedEmail).toBeNull()
  })

  it('accepts a specific tenant with an exact issuer and no Graph mail', async () => {
    const { ctx, urls } = routes(TID, { me: json({ id: 'ms-1' }) })
    const result = await provider(TID).redeem(input, ctx())
    expect(urls()[0]).toBe(TOKEN(TID))
    expect(result.profile).toEqual({
      providerUserId: 'ms-1',
      verifiedEmail: 'signed@example.com',
      data: {},
    })
  })

  it('uses the clock default and forwards an abort signal to token verification', async () => {
    const now = Math.floor(Date.now() / 1000)
    const { fetch, init } = routes('common', {
      token: { id_token: signToken(key, claims({ iat: now, exp: now + 600 })) },
    })
    const signal = new AbortController().signal
    await expect(provider().redeem(input, { fetch, signal })).resolves.toMatchObject({
      profile: { verifiedEmail: 'signed@example.com' },
    })
    expect(init(0)).toMatchObject({ signal })
  })

  it('rejects a different tenant, an invalid tid, or a mismatched signing-key issuer', async () => {
    for (const change of [
      { iss: `https://login.microsoftonline.com/${OTHER}/v2.0` },
      { tid: 'not-a-uuid' },
    ]) {
      const { ctx } = routes('common', { token: { id_token: signToken(key, claims(change)) } })
      await expect(provider().redeem(input, ctx())).rejects.toMatchObject({ code: 'issuer' })
    }
    const { ctx } = routes('common', {
      keyIssuer: `https://login.microsoftonline.com/${OTHER}/v2.0`,
    })
    await expect(provider().redeem(input, ctx())).rejects.toMatchObject({ code: 'issuer' })
  })

  it('rejects wrong specific-tenant issuer, audience, and signature', async () => {
    const cases = [
      {
        token: signToken(key, claims({ iss: `https://login.microsoftonline.com/${OTHER}/v2.0` })),
        code: 'issuer',
      },
      { token: signToken(key, claims({ aud: 'other' })), code: 'audience' },
      { token: signToken(makeKey(key.kid), claims()), code: 'signature' },
    ]
    for (const { token, code } of cases) {
      const { ctx } = routes(TID, { token: { id_token: token } })
      await expect(provider(TID).redeem(input, ctx())).rejects.toMatchObject({ code })
    }
  })

  it('requires PKCE, an ID token, Graph ID, and a matching signed oid', async () => {
    expect(
      await failure(provider().redeem({ code: 'c', redirectUri: 'r' }, routes('common').ctx())),
    ).toMatchObject({ kind: 'malformed' })
    expect(
      await failure(
        provider().redeem(input, routes('common', { token: { id_token: undefined } }).ctx()),
      ),
    ).toMatchObject({ kind: 'malformed' })
    expect(
      await failure(
        provider().redeem(input, routes('common', { me: json({ mail: 'a@example.com' }) }).ctx()),
      ),
    ).toMatchObject({ kind: 'malformed' })
    expect(
      await failure(
        provider().redeem(input, routes('common', { me: json({ id: 'other' }) }).ctx()),
      ),
    ).toMatchObject({ kind: 'malformed' })
  })

  it('surfaces Graph HTTP failures after verification', async () => {
    expect(
      await failure(provider().redeem(input, routes('common', { me: json({}, 500) }).ctx())),
    ).toMatchObject({ kind: 'http', status: 500 })
  })
})
