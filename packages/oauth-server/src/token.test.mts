import { describe, expect, it } from 'vitest'
import {
  OAuthProtocolError,
  createPkceChallenge,
  exchangeTokenGrant,
  revokeToken,
  type AuthorizationCodeRecord,
  type ClientCredentials,
  type RefreshTokenRecord,
  type TokenDependencies,
} from './index.mts'
import {
  NOW,
  USER_RESOURCE,
  createMemoryStore,
  hashSecret,
  makeClient,
  makeConfidentialClient,
  policy,
  type MemoryStore,
} from './test-helpers.mts'

const VERIFIER = 'v'.repeat(43)
const redirectUri = 'https://app.example.test/callback'
const pub: ClientCredentials = { clientId: 'client-1' }

function setup(extra: Partial<TokenDependencies> = {}) {
  const store = createMemoryStore([makeClient(), makeConfidentialClient()])
  const deps: TokenDependencies = {
    clients: store,
    grants: store,
    scopes: policy,
    hashSecret,
    now: () => NOW,
    ...extra,
  }
  return { store, deps }
}

function seedCode(store: MemoryStore, overrides: Partial<AuthorizationCodeRecord> = {}) {
  store.codes.set(hashSecret('authorization-code', 'the-code'), {
    clientId: 'client-1',
    redirectUri,
    resource: USER_RESOURCE,
    scopes: ['mcp.user:write', 'mcp.user:read'],
    codeChallenge: createPkceChallenge(VERIFIER),
    grantId: 'g1',
    subject: 'u1',
    expiresAt: new Date(NOW.getTime() + 60_000),
    replayed: false,
    ...overrides,
  })
}

function seedRefresh(store: MemoryStore, overrides: Partial<RefreshTokenRecord> = {}) {
  store.refresh.set(hashSecret('refresh-token', 'the-refresh'), {
    clientId: 'client-1',
    grantId: 'g1',
    subject: 'u1',
    familyId: 'fam',
    generation: 2,
    resource: USER_RESOURCE,
    scopes: ['mcp.user:write', 'mcp.user:read'],
    familyExpiresAt: new Date(NOW.getTime() + 86_400_000),
    expiresAt: new Date(NOW.getTime() + 86_400_000),
    revoked: false,
    replayed: false,
    ...overrides,
  })
}

const codeForm = (extra = '') =>
  new URLSearchParams(
    `grant_type=authorization_code&code=the-code&redirect_uri=${encodeURIComponent(redirectUri)}&code_verifier=${VERIFIER}${extra}`,
  )
const refreshForm = (extra = '') =>
  new URLSearchParams(`grant_type=refresh_token&refresh_token=the-refresh${extra}`)

async function errorOf(promise: Promise<unknown>): Promise<OAuthProtocolError> {
  try {
    await promise
  } catch (err) {
    return err as OAuthProtocolError
  }
  throw new Error('expected failure')
}

describe('authorization_code grant', () => {
  it('exchanges a code for hashed, family-bound tokens', async () => {
    const { store, deps } = setup({ newFamilyId: () => 'fam-1' })
    seedCode(store)
    const response = await exchangeTokenGrant(codeForm(`&resource=${USER_RESOURCE}`), pub, deps)
    expect(response).toMatchObject({
      token_type: 'Bearer',
      expires_in: 3600,
      scope: 'mcp.user:write mcp.user:read',
    })
    expect(response.access_token.startsWith('access_')).toBe(true)
    expect(response.refresh_token.startsWith('refresh_')).toBe(true)
    const saved = store.tokens[0]!
    expect(saved).toMatchObject({
      clientId: 'client-1',
      grantId: 'g1',
      subject: 'u1',
      familyId: 'fam-1',
      generation: 0,
      resource: USER_RESOURCE,
      accessTokenHash: hashSecret('access-token', response.access_token),
      refreshTokenHash: hashSecret('refresh-token', response.refresh_token),
      refreshExpiresAt: new Date(NOW.getTime() + 30 * 86_400_000),
    })
    expect(JSON.stringify(saved)).not.toContain(response.access_token)
  })

  it('uses random family ids and default clocks when not injected', async () => {
    const { store, deps } = setup()
    delete deps.now
    seedCode(store, { expiresAt: new Date(Date.now() + 60_000) })
    await exchangeTokenGrant(codeForm(), pub, deps)
    expect(store.tokens[0]?.familyId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('honors custom lifetimes and prefixes', async () => {
    const { store, deps } = setup({
      lifetimes: { accessTokenMs: 10_000, refreshTokenMs: 60_000 },
      prefixes: { accessToken: 'at_', refreshToken: 'rt_' },
    })
    seedCode(store)
    const response = await exchangeTokenGrant(codeForm(), pub, deps)
    expect(response.access_token.startsWith('at_')).toBe(true)
    expect(response.refresh_token.startsWith('rt_')).toBe(true)
    expect(response.expires_in).toBe(10)
  })

  it('clamps the access token to the refresh family lifetime', async () => {
    const { store, deps } = setup({ lifetimes: { refreshTokenMs: 5_000 } })
    seedCode(store)
    expect((await exchangeTokenGrant(codeForm(), pub, deps)).expires_in).toBe(5)
  })

  it('makes a code single use and flags the replay', async () => {
    const { store, deps } = setup()
    seedCode(store)
    await exchangeTokenGrant(codeForm(), pub, deps)
    const err = await errorOf(exchangeTokenGrant(codeForm(), pub, deps))
    expect(err).toMatchObject({ code: 'invalid_grant', status: 400 })
    expect(store.tokens).toHaveLength(1)
  })

  it.each([
    ['unknown code', undefined, {}],
    ['other client', {}, { clientId: 'confidential' }],
    ['expired', {}, { expiresAt: NOW }],
    ['redirect mismatch', {}, { redirectUri: 'https://app.example.test/callback/' }],
    ['wrong PKCE challenge', {}, { codeChallenge: createPkceChallenge('x'.repeat(43)) }],
    ['already consumed', {}, { replayed: true }],
  ] as const)('rejects %s', async (_name, seed, overrides) => {
    const { store, deps } = setup()
    if (seed) seedCode(store, overrides)
    const err = await errorOf(exchangeTokenGrant(codeForm(), pub, deps))
    expect(err.code).toBe('invalid_grant')
    expect(store.tokens).toHaveLength(0)
  })

  it('rejects malformed verifiers before consuming the code', async () => {
    const { store, deps } = setup()
    seedCode(store)
    const form = new URLSearchParams(codeForm())
    form.set('code_verifier', 'short')
    expect((await errorOf(exchangeTokenGrant(form, pub, deps))).code).toBe('invalid_grant')
    form.delete('code_verifier')
    expect((await errorOf(exchangeTokenGrant(form, pub, deps))).code).toBe('invalid_grant')
    expect(store.codes.get(hashSecret('authorization-code', 'the-code'))?.replayed).toBe(false)
  })

  it('requires code and redirect_uri and checks the resource binding', async () => {
    const { store, deps } = setup()
    seedCode(store)
    for (const name of ['code', 'redirect_uri']) {
      const form = codeForm()
      form.delete(name)
      expect((await errorOf(exchangeTokenGrant(form, pub, deps))).code).toBe('invalid_request')
    }
    const err = await errorOf(exchangeTokenGrant(codeForm('&resource=https://x.test'), pub, deps))
    expect(err.code).toBe('invalid_target')
    expect((await errorOf(exchangeTokenGrant(codeForm('&resource='), pub, deps))).code).toBe(
      'invalid_request',
    )
  })
})

describe('refresh_token grant', () => {
  it('rotates the refresh token within the same family', async () => {
    const { store, deps } = setup()
    seedRefresh(store)
    const response = await exchangeTokenGrant(refreshForm(), pub, deps)
    expect(store.tokens[0]).toMatchObject({
      familyId: 'fam',
      generation: 3,
      refreshExpiresAt: new Date(NOW.getTime() + 86_400_000),
    })
    expect(response.expires_in).toBe(3600)
    const err = await errorOf(exchangeTokenGrant(refreshForm(), pub, deps))
    expect(err.code).toBe('invalid_grant')
  })

  it('uses the real clock by default', async () => {
    const { store, deps } = setup()
    delete deps.now
    const future = new Date(Date.now() + 60_000)
    seedRefresh(store, { expiresAt: future, familyExpiresAt: future })
    expect((await exchangeTokenGrant(refreshForm(), pub, deps)).token_type).toBe('Bearer')
  })

  it('narrows scope on request and refuses to widen it', async () => {
    const { store, deps } = setup()
    seedRefresh(store)
    const narrowed = await exchangeTokenGrant(refreshForm('&scope=mcp.user:read'), pub, deps)
    expect(narrowed.scope).toBe('mcp.user:read')
    seedRefresh(store, { scopes: ['mcp.user:read'] })
    const err = await errorOf(exchangeTokenGrant(refreshForm('&scope=mcp.user:write'), pub, deps))
    expect(err.code).toBe('invalid_scope')
    seedRefresh(store)
    expect((await errorOf(exchangeTokenGrant(refreshForm('&scope=nope'), pub, deps))).code).toBe(
      'invalid_scope',
    )
    seedRefresh(store)
    expect((await errorOf(exchangeTokenGrant(refreshForm('&scope='), pub, deps))).code).toBe(
      'invalid_request',
    )
  })

  it.each([
    ['unknown token', undefined, {}],
    ['replayed token', {}, { replayed: true }],
    ['revoked token', {}, { revoked: true }],
    ['other client', {}, { clientId: 'confidential' }],
    ['expired token', {}, { expiresAt: NOW }],
    ['expired family', {}, { familyExpiresAt: NOW }],
  ] as const)('rejects %s', async (_name, seed, overrides) => {
    const { store, deps } = setup()
    if (seed) seedRefresh(store, overrides)
    expect((await errorOf(exchangeTokenGrant(refreshForm(), pub, deps))).code).toBe('invalid_grant')
    expect(store.tokens).toHaveLength(0)
  })

  it('enforces the resource binding and a required token', async () => {
    const { store, deps } = setup()
    seedRefresh(store)
    const err = await errorOf(
      exchangeTokenGrant(refreshForm('&resource=https://x.test'), pub, deps),
    )
    expect(err.code).toBe('invalid_target')
    const form = refreshForm()
    form.delete('refresh_token')
    expect((await errorOf(exchangeTokenGrant(form, pub, deps))).code).toBe('invalid_request')
  })
})

describe('client authentication at the token endpoint', () => {
  it('rejects unsupported grant types after authenticating', async () => {
    const { deps } = setup()
    const err = await errorOf(
      exchangeTokenGrant(new URLSearchParams('grant_type=password'), pub, deps),
    )
    expect(err.code).toBe('unsupported_grant_type')
    const bad = await errorOf(
      exchangeTokenGrant(new URLSearchParams('grant_type=password'), { clientId: 'ghost' }, deps),
    )
    expect(bad).toMatchObject({ code: 'invalid_client', status: 401 })
  })

  it('verifies confidential secrets', async () => {
    const { store, deps } = setup()
    seedCode(store, { clientId: 'confidential' })
    const ok = await exchangeTokenGrant(
      codeForm(),
      { clientId: 'confidential', clientSecret: 'shh' },
      deps,
    )
    expect(ok.token_type).toBe('Bearer')
    for (const credentials of [
      { clientId: 'confidential', clientSecret: 'wrong' },
      { clientId: 'confidential', clientSecret: '' },
      { clientId: 'confidential' },
    ]) {
      const err = await errorOf(exchangeTokenGrant(codeForm(), credentials, deps))
      expect(err).toMatchObject({ code: 'invalid_client', status: 401 })
    }
  })

  it('rejects public clients that send a secret and confidential clients without a hash', async () => {
    const { store, deps } = setup()
    store.clients.set(
      'nohash',
      makeClient({ clientId: 'nohash', tokenEndpointAuthMethod: 'client_secret_basic' }),
    )
    const secretless = await errorOf(
      exchangeTokenGrant(codeForm(), { clientId: 'client-1', clientSecret: 'x' }, deps),
    )
    expect(secretless.code).toBe('invalid_client')
    const nohash = await errorOf(
      exchangeTokenGrant(codeForm(), { clientId: 'nohash', clientSecret: 'x' }, deps),
    )
    expect(nohash.code).toBe('invalid_client')
  })
})

describe('revokeToken', () => {
  it('authenticates the client and revokes under both token purposes', async () => {
    const { store, deps } = setup()
    await revokeToken(new URLSearchParams('token=abc'), pub, deps)
    expect(store.revoked).toEqual([
      { hash: hashSecret('refresh-token', 'abc'), clientId: 'client-1' },
      { hash: hashSecret('access-token', 'abc'), clientId: 'client-1' },
    ])
  })

  it('rejects unauthenticated clients and missing tokens', async () => {
    const { store, deps } = setup()
    await expect(
      revokeToken(new URLSearchParams('token=abc'), { clientId: 'ghost' }, deps),
    ).rejects.toMatchObject({ code: 'invalid_client' })
    await expect(revokeToken(new URLSearchParams(), pub, deps)).rejects.toMatchObject({
      code: 'invalid_request',
    })
    expect(store.revoked).toHaveLength(0)
  })
})
