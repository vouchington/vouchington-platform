import { OAuthProtocolError, invalidRequest } from './errors.mts'
import { DEFAULT_TOKEN_LIFETIMES, DEFAULT_TOKEN_PREFIXES } from './lifetimes.mts'
import { validatePkceChallenge } from './pkce.mts'
import { matchesRegisteredRedirectUri } from './redirect-uri.mts'
import { buildAuthorizationResponseUrl } from './responses.mts'
import {
  assertClientMayRequestScopes,
  assertScopesMatchResource,
  parseScopeParameter,
  resolveRequiredResource,
} from './scopes.mts'
import { generateOpaqueToken } from './secrets.mts'
import type {
  ClientStore,
  GrantStore,
  HashSecret,
  OAuthClient,
  ResolveResource,
  ScopePolicy,
  TokenLifetimes,
} from './types.mts'

const MAX_STATE_LENGTH = 1024

/** Raw authorization endpoint parameters; everything but `clientId` and `redirectUri` is unchecked. */
export interface AuthorizationParameters {
  clientId: string
  redirectUri: string
  responseType: unknown
  scope: unknown
  resource: unknown
  state: unknown
  codeChallenge: unknown
  codeChallengeMethod: unknown
}

export interface ValidatedAuthorizationRequest {
  client: OAuthClient
  codeChallenge: string
  redirectUri: string
  resource: string
  scopes: string[]
  state: string
}

export interface AuthorizationDependencies {
  clients: ClientStore
  scopes: ScopePolicy
  resolveResource: ResolveResource
}

/**
 * Validates an authorization request: code response type, state, scopes, RFC 8707 resource,
 * S256 PKCE, a known client, an exactly registered redirect URI, and client scope coverage.
 */
export async function validateAuthorizationRequest(
  input: AuthorizationParameters,
  deps: AuthorizationDependencies,
): Promise<ValidatedAuthorizationRequest> {
  if (input.responseType !== 'code') {
    throw new OAuthProtocolError('unsupported_response_type', 'response_type must be code')
  }
  const state = input.state
  if (typeof state !== 'string' || state.length === 0 || state.length > MAX_STATE_LENGTH) {
    throw invalidRequest('state is required')
  }
  const { scopes, audiences } = parseScopeParameter(input.scope, deps.scopes)
  const resource = resolveRequiredResource(input.resource, deps.resolveResource)
  assertScopesMatchResource(audiences, resource)
  const codeChallenge = validatePkceChallenge(input.codeChallenge, input.codeChallengeMethod)
  const client = await deps.clients.findClient(input.clientId)
  if (!client) throw new OAuthProtocolError('unauthorized_client', 'client is not registered')
  if (!matchesRegisteredRedirectUri(input.redirectUri, client.redirectUris)) {
    throw invalidRequest('redirect_uri is not registered for this client')
  }
  assertClientMayRequestScopes(deps.scopes, client.scopes, scopes)
  return {
    client,
    codeChallenge,
    redirectUri: input.redirectUri,
    resource: resource.url,
    scopes,
    state,
  }
}

/**
 * RFC 6749 section 4.1.2.1: errors may only redirect to a registered redirect URI. Returns null
 * when the client or URI cannot be trusted, in which case the application renders the error.
 */
export async function authorizationErrorRedirect(
  input: { clientId: string; redirectUri: string; state: unknown; error: OAuthProtocolError },
  deps: { clients: ClientStore; issuer: string },
): Promise<string | null> {
  const client = await deps.clients.findClient(input.clientId)
  if (!client || !matchesRegisteredRedirectUri(input.redirectUri, client.redirectUris)) return null
  return buildAuthorizationResponseUrl(
    input.redirectUri,
    {
      error: input.error.code,
      error_description: input.error.message,
      ...(typeof input.state === 'string' && input.state.length <= MAX_STATE_LENGTH
        ? { state: input.state }
        : {}),
    },
    deps.issuer,
  )
}

/** Redirect URL for a user who declined consent. */
export function denyAuthorization(request: ValidatedAuthorizationRequest, issuer: string): string {
  return buildAuthorizationResponseUrl(
    request.redirectUri,
    { error: 'access_denied', state: request.state },
    issuer,
  )
}

export interface CodeIssuanceDependencies {
  grants: Pick<GrantStore, 'saveAuthorizationCode'>
  hashSecret: HashSecret
  issuer: string
  lifetimes?: Partial<Pick<TokenLifetimes, 'authorizationCodeMs'>>
  /** Prefix for generated authorization codes. Defaults to "code_". */
  codePrefix?: string
  now?: () => Date
}

/**
 * After the application records consent as `grantId` for `subject`, mints a single-use code bound
 * to the client, redirect URI, resource, scopes and PKCE challenge, and builds the redirect URL.
 */
export async function issueAuthorizationCode(
  request: ValidatedAuthorizationRequest,
  consent: { grantId: string; subject: string },
  deps: CodeIssuanceDependencies,
): Promise<{ code: string; redirectUrl: string }> {
  const code = generateOpaqueToken(deps.codePrefix ?? DEFAULT_TOKEN_PREFIXES.authorizationCode)
  const now = deps.now?.() ?? new Date()
  await deps.grants.saveAuthorizationCode({
    codeHash: deps.hashSecret('authorization-code', code),
    clientId: request.client.clientId,
    redirectUri: request.redirectUri,
    resource: request.resource,
    scopes: request.scopes,
    codeChallenge: request.codeChallenge,
    grantId: consent.grantId,
    subject: consent.subject,
    expiresAt: new Date(
      now.getTime() +
        (deps.lifetimes?.authorizationCodeMs ?? DEFAULT_TOKEN_LIFETIMES.authorizationCodeMs),
    ),
  })
  return {
    code,
    redirectUrl: buildAuthorizationResponseUrl(
      request.redirectUri,
      { code, state: request.state },
      deps.issuer,
    ),
  }
}
