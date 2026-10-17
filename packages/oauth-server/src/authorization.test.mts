import { describe, expect, it } from 'vitest'
import {
  OAuthProtocolError,
  authorizationErrorRedirect,
  createPkceChallenge,
  denyAuthorization,
  issueAuthorizationCode,
  validateAuthorizationRequest,
  type AuthorizationParameters,
} from './index.mts'
import {
  ADMIN_RESOURCE,
  NOW,
  USER_RESOURCE,
  createMemoryStore,
  hashSecret,
  makeClient,
  policy,
  resolveResource,
} from './test-helpers.mts'

const VERIFIER = 'v'.repeat(43)
const redirectUri = 'https://app.example.test/callback'

function params(overrides: Partial<AuthorizationParameters> = {}): AuthorizationParameters {
  return {
    clientId: 'client-1',
    redirectUri,
    responseType: 'code',
    scope: 'mcp.user:read',
    resource: USER_RESOURCE,
    state: 'st',
    codeChallenge: createPkceChallenge(VERIFIER),
    codeChallengeMethod: 'S256',
    ...overrides,
  }
}

const clients = createMemoryStore([makeClient()])
const deps = { clients, scopes: policy, resolveResource }

async function failure(overrides: Partial<AuthorizationParameters>): Promise<OAuthProtocolError> {
  try {
    await validateAuthorizationRequest(params(overrides), deps)
  } catch (err) {
    return err as OAuthProtocolError
  }
  throw new Error('expected failure')
}

describe('validateAuthorizationRequest', () => {
  it('returns the validated request for a well-formed call', async () => {
    const result = await validateAuthorizationRequest(params(), deps)
    expect(result).toMatchObject({
      codeChallenge: createPkceChallenge(VERIFIER),
      redirectUri,
      resource: USER_RESOURCE,
      scopes: ['mcp.user:read'],
      state: 'st',
    })
    expect(result.client.clientId).toBe('client-1')
  })

  it.each([
    ['response_type', { responseType: 'token' }, 'unsupported_response_type'],
    ['missing state', { state: undefined }, 'invalid_request'],
    ['empty state', { state: '' }, 'invalid_request'],
    ['oversized state', { state: 's'.repeat(1025) }, 'invalid_request'],
    ['missing scope', { scope: undefined }, 'invalid_scope'],
    ['unknown scope', { scope: 'nope' }, 'invalid_scope'],
    ['missing resource', { resource: undefined }, 'invalid_request'],
    ['unknown resource', { resource: 'https://other.test' }, 'invalid_target'],
    ['audience mismatch', { resource: ADMIN_RESOURCE }, 'invalid_scope'],
    ['plain PKCE', { codeChallengeMethod: 'plain' }, 'invalid_request'],
    ['missing PKCE', { codeChallenge: undefined }, 'invalid_request'],
    ['unknown client', { clientId: 'ghost' }, 'unauthorized_client'],
    ['prefix redirect', { redirectUri: `${redirectUri}/extra` }, 'invalid_request'],
    ['scope beyond client', { scope: 'mcp.user:read mcp.admin:read' }, 'invalid_scope'],
  ] as const)('rejects %s', async (_name, overrides, code) => {
    expect((await failure(overrides)).code).toBe(code)
  })

  it('does not widen a read-only client to write', async () => {
    const readOnly = createMemoryStore([makeClient({ scopes: ['mcp.user:read'] })])
    await expect(
      validateAuthorizationRequest(params({ scope: 'mcp.user:write' }), {
        ...deps,
        clients: readOnly,
      }),
    ).rejects.toMatchObject({ code: 'invalid_scope' })
  })
})

describe('authorizationErrorRedirect', () => {
  const error = new OAuthProtocolError('invalid_scope', 'bad scope')
  const issuer = 'https://as.example.test'

  it('redirects to registered URIs with state and iss', async () => {
    const location = await authorizationErrorRedirect(
      { clientId: 'client-1', redirectUri, state: 'st', error },
      { clients, issuer },
    )
    const url = new URL(location!)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      error: 'invalid_scope',
      error_description: 'bad scope',
      state: 'st',
      iss: issuer,
    })
  })

  it('omits unusable state values', async () => {
    for (const state of [undefined, 's'.repeat(1025)]) {
      const location = await authorizationErrorRedirect(
        { clientId: 'client-1', redirectUri, state, error },
        { clients, issuer },
      )
      expect(new URL(location!).searchParams.has('state')).toBe(false)
    }
  })

  it('never redirects to unknown clients or unregistered URIs', async () => {
    expect(
      await authorizationErrorRedirect(
        { clientId: 'ghost', redirectUri, state: 's', error },
        { clients, issuer },
      ),
    ).toBeNull()
    expect(
      await authorizationErrorRedirect(
        { clientId: 'client-1', redirectUri: 'https://evil.test/cb', state: 's', error },
        { clients, issuer },
      ),
    ).toBeNull()
  })
})

describe('consent outcomes', () => {
  it('builds an access_denied redirect', async () => {
    const request = await validateAuthorizationRequest(params(), deps)
    const url = new URL(denyAuthorization(request, 'https://as.example.test'))
    expect(Object.fromEntries(url.searchParams)).toEqual({
      error: 'access_denied',
      state: 'st',
      iss: 'https://as.example.test',
    })
  })

  it('mints a hashed, bound, expiring single-use code', async () => {
    const grants = createMemoryStore()
    const request = await validateAuthorizationRequest(params(), deps)
    const issued = await issueAuthorizationCode(
      request,
      { grantId: 'g1', subject: 'u1' },
      { grants, hashSecret, issuer: 'https://as.example.test', now: () => NOW },
    )
    expect(issued.code.startsWith('code_')).toBe(true)
    const url = new URL(issued.redirectUrl)
    expect(url.searchParams.get('code')).toBe(issued.code)
    expect(url.searchParams.get('state')).toBe('st')
    expect(url.searchParams.get('iss')).toBe('https://as.example.test')
    const saved = grants.codes.get(hashSecret('authorization-code', issued.code))
    expect(saved).toMatchObject({
      clientId: 'client-1',
      redirectUri,
      resource: USER_RESOURCE,
      scopes: ['mcp.user:read'],
      codeChallenge: request.codeChallenge,
      grantId: 'g1',
      subject: 'u1',
      expiresAt: new Date(NOW.getTime() + 5 * 60 * 1000),
    })
    expect(grants.codes.has(issued.code)).toBe(false)
  })

  it('honors overridden lifetime and prefix and defaults the clock', async () => {
    const grants = createMemoryStore()
    const request = await validateAuthorizationRequest(params(), deps)
    const issued = await issueAuthorizationCode(
      request,
      { grantId: 'g1', subject: 'u1' },
      {
        grants,
        hashSecret,
        issuer: 'https://as.example.test',
        lifetimes: { authorizationCodeMs: 1000 },
        codePrefix: 'ac_',
      },
    )
    expect(issued.code.startsWith('ac_')).toBe(true)
    const saved = grants.codes.get(hashSecret('authorization-code', issued.code))!
    expect(saved.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(1000)
  })
})
