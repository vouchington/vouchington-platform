import { OAuthProtocolError, invalidTarget } from './errors.mts'
import type { ProtectedResource, ResolveResource, ScopePolicy } from './types.mts'

/** Parses a space-delimited scope parameter against the caller's scope catalog. */
export function parseScopeParameter(
  value: unknown,
  policy: ScopePolicy,
): { scopes: string[]; audiences: string[] } {
  if (typeof value !== 'string') throw new OAuthProtocolError('invalid_scope', 'scope is required')
  const result = policy.catalog.validateScopeSet(value.split(' ').filter(Boolean), {
    surface: policy.surface,
    allowMixedAudiences: true,
  })
  if (!result.valid) {
    throw new OAuthProtocolError('invalid_scope', `invalid scope set: ${result.code}`)
  }
  return { scopes: result.scopes, audiences: result.audiences }
}

/** RFC 8707: accepts exactly one of the canonical resources the server publishes. */
export function resolveRequiredResource(
  value: unknown,
  resolveResource: ResolveResource,
): ProtectedResource {
  if (typeof value !== 'string' || value.length === 0) {
    throw new OAuthProtocolError('invalid_request', 'resource is required')
  }
  const resource = resolveResource(value)
  if (!resource) throw invalidTarget()
  return resource
}

export function assertScopesMatchResource(
  audiences: readonly string[],
  resource: ProtectedResource,
): void {
  if (!audiences.every((audience) => audience === resource.audience)) {
    throw new OAuthProtocolError('invalid_scope', 'scope does not match the requested resource')
  }
}

/** RFC 8707 makes `resource` optional at the token endpoint; when present it must match the grant. */
export function assertTokenRequestResource(requested: string | undefined, bound: string): void {
  if (requested !== undefined && requested !== bound) throw invalidTarget()
}

/**
 * True when every requested scope is covered by the granted scopes. Unknown scopes (for example a
 * scope removed from the catalog after registration) never cover anything.
 */
export function scopesCover(
  policy: ScopePolicy,
  granted: readonly string[],
  requested: readonly string[],
): boolean {
  try {
    return policy.catalog.hasEveryScope(granted, requested)
  } catch (err) {
    if (err instanceof RangeError) return false
    throw err
  }
}

export function assertClientMayRequestScopes(
  policy: ScopePolicy,
  clientScopes: readonly string[],
  requested: readonly string[],
): void {
  if (!scopesCover(policy, clientScopes, requested)) {
    throw new OAuthProtocolError(
      'invalid_scope',
      'requested scope is not registered for this client',
    )
  }
}
