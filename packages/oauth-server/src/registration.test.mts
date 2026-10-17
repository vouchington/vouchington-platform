import { describe, expect, it } from 'vitest'
import {
  OAuthProtocolError,
  assertClientMayRequestScopes,
  assertScopesMatchResource,
  assertTokenRequestResource,
  parseScopeParameter,
  registerClient,
  resolveRequiredResource,
  scopesCover,
  validateAuthMethod,
  validateClientName,
  validateGrantTypes,
  validateRegistrationObject,
  validateResponseTypes,
  type ScopePolicy,
} from './index.mts'
import {
  NOW,
  USER_RESOURCE,
  createMemoryStore,
  hashSecret,
  policy,
  resolveResource,
} from './test-helpers.mts'

function code(fn: () => unknown): string {
  try {
    fn()
  } catch (err) {
    return (err as OAuthProtocolError).code
  }
  return 'none'
}

const base = {
  client_name: ' My App ',
  redirect_uris: ['https://app.test/cb'],
  scope: 'mcp.user:read mcp.user:write',
}

describe('scope helpers', () => {
  it('parses scope parameters against the catalog', () => {
    expect(parseScopeParameter('mcp.user:write  mcp.user:read', policy)).toEqual({
      scopes: ['mcp.user:read', 'mcp.user:write'],
      audiences: ['user'],
    })
    expect(code(() => parseScopeParameter(undefined, policy))).toBe('invalid_scope')
    expect(code(() => parseScopeParameter('', policy))).toBe('invalid_scope')
    expect(code(() => parseScopeParameter('nope', policy))).toBe('invalid_scope')
    expect(code(() => parseScopeParameter('web:only', policy))).toBe('invalid_scope')
  })

  it('resolves resources and checks audiences', () => {
    expect(resolveRequiredResource(USER_RESOURCE, resolveResource).audience).toBe('user')
    expect(code(() => resolveRequiredResource(undefined, resolveResource))).toBe('invalid_request')
    expect(code(() => resolveRequiredResource('', resolveResource))).toBe('invalid_request')
    expect(code(() => resolveRequiredResource('https://x.test', resolveResource))).toBe(
      'invalid_target',
    )
    const user = { url: USER_RESOURCE, audience: 'user' }
    expect(() => assertScopesMatchResource(['user'], user)).not.toThrow()
    expect(code(() => assertScopesMatchResource(['user', 'admin'], user))).toBe('invalid_scope')
    expect(() => assertTokenRequestResource(undefined, 'a')).not.toThrow()
    expect(() => assertTokenRequestResource('a', 'a')).not.toThrow()
    expect(code(() => assertTokenRequestResource('b', 'a'))).toBe('invalid_target')
  })

  it('treats catalog coverage safely', () => {
    expect(scopesCover(policy, ['mcp.user:write'], ['mcp.user:read'])).toBe(true)
    expect(scopesCover(policy, ['mcp.user:read'], ['mcp.user:write'])).toBe(false)
    expect(scopesCover(policy, ['removed:scope'], ['mcp.user:read'])).toBe(false)
    const broken: ScopePolicy = {
      surface: 'oauth',
      catalog: {
        ...policy.catalog,
        hasEveryScope: () => {
          throw new Error('boom')
        },
      },
    }
    expect(() => scopesCover(broken, [], [])).toThrow('boom')
    expect(() =>
      assertClientMayRequestScopes(policy, ['mcp.user:write'], ['mcp.user:read']),
    ).not.toThrow()
    expect(
      code(() => assertClientMayRequestScopes(policy, ['mcp.user:read'], ['mcp.user:write'])),
    ).toBe('invalid_scope')
  })
})

describe('RFC 7591 metadata validators', () => {
  it('validates the registration object and name', () => {
    expect(validateRegistrationObject({ a: 1 })).toEqual({ a: 1 })
    for (const bad of [null, [], 'x', 1]) {
      expect(code(() => validateRegistrationObject(bad))).toBe('invalid_client_metadata')
    }
    expect(validateClientName('  Name ')).toBe('Name')
    for (const bad of [1, '   ', 'a'.repeat(121), 'a\nb', 'a​b']) {
      expect(code(() => validateClientName(bad))).toBe('invalid_client_metadata')
    }
  })

  it('validates auth methods, grants, and response types', () => {
    expect(validateAuthMethod(undefined)).toBe('none')
    expect(validateAuthMethod('none')).toBe('none')
    expect(validateAuthMethod('client_secret_basic')).toBe('client_secret_basic')
    expect(code(() => validateAuthMethod('client_secret_post'))).toBe('invalid_client_metadata')
    expect(validateGrantTypes(undefined)).toEqual(['authorization_code', 'refresh_token'])
    expect(validateGrantTypes(['refresh_token', 'authorization_code'])).toEqual([
      'authorization_code',
      'refresh_token',
    ])
    for (const bad of [
      'x',
      [],
      ['authorization_code', 'authorization_code'],
      ['authorization_code'],
      ['refresh_token', 'implicit'],
      ['authorization_code', 'refresh_token', 'password'],
    ]) {
      expect(code(() => validateGrantTypes(bad))).toBe('invalid_client_metadata')
    }
    expect(validateResponseTypes(undefined)).toEqual(['code'])
    expect(validateResponseTypes(['code'])).toEqual(['code'])
    for (const bad of ['code', [], ['token'], ['code', 'token']]) {
      expect(code(() => validateResponseTypes(bad))).toBe('invalid_client_metadata')
    }
  })
})

describe('registerClient', () => {
  it('registers a public client and stores no secret', async () => {
    const registry = createMemoryStore()
    const deps = { registry, scopes: policy, hashSecret, now: () => NOW }
    const result = await registerClient(base, deps, { owner: 'u1' })
    expect(result).toMatchObject({
      client_name: 'My App',
      client_id_issued_at: NOW.getTime() / 1000,
      grant_types: ['authorization_code', 'refresh_token'],
      redirect_uris: ['https://app.test/cb'],
      response_types: ['code'],
      scope: 'mcp.user:read mcp.user:write',
      token_endpoint_auth_method: 'none',
    })
    expect(result.client_id.startsWith('client_')).toBe(true)
    expect(result).not.toHaveProperty('client_secret')
    expect(registry.created[0]?.context).toEqual({ owner: 'u1' })
    expect(registry.created[0]?.client.clientSecretHash).toBeNull()
  })

  it('registers a confidential client and stores only the secret hash', async () => {
    const registry = createMemoryStore()
    const result = await registerClient(
      { ...base, token_endpoint_auth_method: 'client_secret_basic' },
      {
        registry,
        scopes: policy,
        hashSecret,
        clientIdPrefix: 'acme_',
        clientSecretPrefix: 'acme_secret_',
      },
    )
    expect(result.client_id.startsWith('acme_')).toBe(true)
    expect(result.client_secret?.startsWith('acme_secret_')).toBe(true)
    expect(result.client_secret_expires_at).toBe(0)
    const stored = registry.created[0]!.client
    expect(stored.clientSecretHash).toBe(hashSecret('client-secret', result.client_secret!))
    expect(JSON.stringify(stored)).not.toContain(result.client_secret)
  })

  it('defaults the generated secret prefix', async () => {
    const registry = createMemoryStore()
    const result = await registerClient(
      { ...base, token_endpoint_auth_method: 'client_secret_basic' },
      { registry, scopes: policy, hashSecret },
    )
    expect(result.client_secret?.startsWith('secret_')).toBe(true)
  })

  it('maps scope failures to invalid_client_metadata and rethrows unexpected errors', async () => {
    const registry = createMemoryStore()
    const deps = { registry, scopes: policy, hashSecret }
    await expect(registerClient({ ...base, scope: 'nope' }, deps)).rejects.toMatchObject({
      code: 'invalid_client_metadata',
    })
    await expect(
      registerClient({ ...base, redirect_uris: ['http://a.test'] }, deps),
    ).rejects.toMatchObject({ code: 'invalid_redirect_uri' })
    const broken: ScopePolicy = {
      surface: 'oauth',
      catalog: {
        ...policy.catalog,
        validateScopeSet: () => {
          throw new Error('boom')
        },
      },
    }
    await expect(registerClient(base, { ...deps, scopes: broken })).rejects.toThrow('boom')
    expect(registry.created).toHaveLength(0)
  })
})
