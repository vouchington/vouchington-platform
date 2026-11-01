import { authenticateClient } from './client-auth.mts'
import { OAuthProtocolError, invalidGrant } from './errors.mts'
import { DEFAULT_TOKEN_LIFETIMES, DEFAULT_TOKEN_PREFIXES } from './lifetimes.mts'
import { validatePkceVerifier, verifyPkce } from './pkce.mts'
import { requiredFormValue, type ClientCredentials } from './request.mts'
import { assertTokenRequestResource, parseScopeParameter, scopesCover } from './scopes.mts'
import { generateOpaqueToken } from './secrets.mts'
import type {
  AuthorizationCodeRecord,
  ClientStore,
  GrantStore,
  HashSecret,
  IssuedTokens,
  OAuthClient,
  RefreshTokenRecord,
  ScopePolicy,
  TokenLifetimes,
  TokenPrefixes,
  TokenResponse,
} from './types.mts'

export interface TokenDependencies {
  clients: ClientStore
  grants: GrantStore
  scopes: ScopePolicy
  hashSecret: HashSecret
  lifetimes?: Partial<TokenLifetimes>
  prefixes?: Partial<TokenPrefixes>
  now?: () => Date
  /** Generates refresh family ids. Defaults to `crypto.randomUUID`. */
  newFamilyId?: () => string
}

type Subject = Pick<RefreshTokenRecord, 'grantId' | 'subject' | 'resource'> & {
  scopes: readonly string[]
  refreshScopes: readonly string[]
}

/**
 * Handles the token endpoint for `authorization_code` and `refresh_token` grants: authenticates the
 * client, then verifies the grant inside the store's redeem transaction. Codes and refresh tokens are
 * single use; the adapter owns the transaction and decides what a failed redemption spends.
 */
export async function exchangeTokenGrant(
  form: URLSearchParams,
  credentials: ClientCredentials,
  deps: TokenDependencies,
): Promise<TokenResponse> {
  const client = await authenticateClient(deps.clients, credentials, deps.hashSecret)
  const grantType = form.get('grant_type')
  const resource = form.has('resource') ? requiredFormValue(form, 'resource') : undefined
  if (grantType === 'authorization_code') {
    return exchangeAuthorizationCode(form, client, resource, deps)
  }
  if (grantType === 'refresh_token') return exchangeRefreshToken(form, client, resource, deps)
  throw new OAuthProtocolError('unsupported_grant_type', 'grant_type is not supported')
}

async function exchangeAuthorizationCode(
  form: URLSearchParams,
  client: OAuthClient,
  resource: string | undefined,
  deps: TokenDependencies,
): Promise<TokenResponse> {
  const code = requiredFormValue(form, 'code')
  const redirectUri = requiredFormValue(form, 'redirect_uri')
  const verifier = validatePkceVerifier(form.get('code_verifier'))
  let response: TokenResponse | undefined
  await deps.grants.redeemAuthorizationCode(
    deps.hashSecret('authorization-code', code),
    (record) => {
      const now = (deps.now?.() ?? new Date()).getTime()
      assertCodeUsable(record, client, redirectUri, verifier, now)
      assertTokenRequestResource(resource, record.resource)
      const lifetimes = { ...DEFAULT_TOKEN_LIFETIMES, ...deps.lifetimes }
      const issued = buildTokens({
        client,
        subject: { ...record, refreshScopes: record.scopes },
        familyId: (deps.newFamilyId ?? crypto.randomUUID.bind(crypto))(),
        generation: 0,
        refreshExpiresAt: new Date(now + lifetimes.refreshTokenMs),
        now,
        deps,
      })
      response = issued.response
      return issued.tokens
    },
  )
  return response!
}

function assertCodeUsable(
  record: AuthorizationCodeRecord | null,
  client: OAuthClient,
  redirectUri: string,
  verifier: string,
  now: number,
): asserts record is AuthorizationCodeRecord {
  if (
    !record ||
    record.replayed ||
    record.clientId !== client.clientId ||
    record.expiresAt.getTime() <= now ||
    record.redirectUri !== redirectUri ||
    !verifyPkce(record.codeChallenge, verifier)
  ) {
    throw invalidGrant('authorization code is invalid')
  }
}

async function exchangeRefreshToken(
  form: URLSearchParams,
  client: OAuthClient,
  resource: string | undefined,
  deps: TokenDependencies,
): Promise<TokenResponse> {
  const token = requiredFormValue(form, 'refresh_token')
  const requestedScope = form.has('scope') ? requiredFormValue(form, 'scope') : undefined
  let response: TokenResponse | undefined
  await deps.grants.redeemRefreshToken(deps.hashSecret('refresh-token', token), (record) => {
    const now = (deps.now?.() ?? new Date()).getTime()
    if (
      !record ||
      record.replayed ||
      record.revoked ||
      record.clientId !== client.clientId ||
      record.expiresAt.getTime() <= now ||
      record.familyExpiresAt.getTime() <= now
    ) {
      throw invalidGrant('refresh token is invalid')
    }
    assertTokenRequestResource(resource, record.resource)
    let scopes = record.scopes
    if (requestedScope !== undefined) {
      const requested = parseScopeParameter(requestedScope, deps.scopes).scopes
      if (!scopesCover(deps.scopes, record.scopes, requested)) {
        throw new OAuthProtocolError('invalid_scope', 'scope exceeds the original grant')
      }
      scopes = requested
    }
    const issued = buildTokens({
      client,
      subject: { ...record, scopes, refreshScopes: record.scopes },
      familyId: record.familyId,
      generation: record.generation + 1,
      refreshExpiresAt: record.familyExpiresAt,
      now,
      deps,
    })
    response = issued.response
    return issued.tokens
  })
  return response!
}

function buildTokens(input: {
  client: OAuthClient
  subject: Subject
  familyId: string
  generation: number
  refreshExpiresAt: Date
  now: number
  deps: TokenDependencies
}): { tokens: IssuedTokens; response: TokenResponse } {
  const { client, subject, deps, now } = input
  const prefixes = { ...DEFAULT_TOKEN_PREFIXES, ...deps.prefixes }
  const lifetimes = { ...DEFAULT_TOKEN_LIFETIMES, ...deps.lifetimes }
  const accessToken = generateOpaqueToken(prefixes.accessToken)
  const refreshToken = generateOpaqueToken(prefixes.refreshToken)
  // An access token never outlives the refresh family that authorizes it.
  const accessExpiresAt = new Date(
    Math.min(now + lifetimes.accessTokenMs, input.refreshExpiresAt.getTime()),
  )
  const tokens: IssuedTokens = {
    clientId: client.clientId,
    grantId: subject.grantId,
    subject: subject.subject,
    familyId: input.familyId,
    generation: input.generation,
    resource: subject.resource,
    scopes: subject.scopes,
    refreshScopes: subject.refreshScopes,
    accessTokenHash: deps.hashSecret('access-token', accessToken),
    accessExpiresAt,
    refreshTokenHash: deps.hashSecret('refresh-token', refreshToken),
    refreshExpiresAt: input.refreshExpiresAt,
  }
  const response: TokenResponse = {
    access_token: accessToken,
    expires_in: Math.max(0, Math.floor((accessExpiresAt.getTime() - now) / 1000)),
    refresh_token: refreshToken,
    scope: subject.scopes.join(' '),
    token_type: 'Bearer',
  }
  return { tokens, response }
}
