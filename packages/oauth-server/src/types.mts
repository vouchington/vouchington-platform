import type { ScopeCatalog } from '@vouchington/utils/scopes'

export type ClientAuthMethod = 'none' | 'client_secret_basic'

/** Distinct purposes let the application derive independent hashes for each secret kind. */
export type SecretPurpose =
  | 'client-secret'
  | 'access-token'
  | 'refresh-token'
  | 'authorization-code'

/** Application-supplied one-way hash (for example a keyed HMAC) used for every stored secret. */
export type HashSecret = (purpose: SecretPurpose, value: string) => string

export interface ScopePolicy {
  catalog: ScopeCatalog
  /** Catalog surface that OAuth clients may request, for example "oauth". */
  surface: string
}

/** RFC 8707 protected resource. `audience` is matched against the scope catalog audiences. */
export interface ProtectedResource {
  url: string
  audience: string
}

export type ResolveResource = (value: string) => ProtectedResource | null

export interface OAuthClient {
  clientId: string
  clientName: string
  redirectUris: readonly string[]
  scopes: readonly string[]
  tokenEndpointAuthMethod: ClientAuthMethod
  /** Hash produced by `HashSecret('client-secret', ...)`; null for public clients. */
  clientSecretHash: string | null
}

export interface NewOAuthClient extends OAuthClient {
  grantTypes: string[]
  responseTypes: string[]
  issuedAt: Date
}

/** Returns only clients that may currently authorize; revoked or ineligible clients are null. */
export interface ClientStore {
  findClient(clientId: string): Promise<OAuthClient | null>
}

export interface ClientRegistry extends ClientStore {
  /** `context` is the opaque value the application passed to `registerClient`, such as an owner. */
  createClient(client: NewOAuthClient, context?: unknown): Promise<void>
}

export interface AuthorizationCodeRecord {
  clientId: string
  redirectUri: string
  resource: string
  scopes: readonly string[]
  codeChallenge: string
  grantId: string
  subject: string
  expiresAt: Date
  /** True when the code had already been consumed before this call. */
  replayed: boolean
}

export interface RefreshTokenRecord {
  clientId: string
  grantId: string
  subject: string
  familyId: string
  generation: number
  resource: string
  scopes: readonly string[]
  /** Expiry of the whole refresh family; rotated refresh tokens never extend it. */
  familyExpiresAt: Date
  expiresAt: Date
  revoked: boolean
  /** True when the token had already been rotated before this call. */
  replayed: boolean
}

export interface IssuedTokens {
  clientId: string
  grantId: string
  subject: string
  familyId: string
  generation: number
  resource: string
  /** Scopes of the access token; a narrowed refresh request narrows only these. */
  scopes: readonly string[]
  /**
   * Scopes of the underlying grant. Persist these (not `scopes`) on the rotated refresh token so a
   * narrowed refresh does not permanently narrow the grant (RFC 6749 section 6).
   */
  refreshScopes: readonly string[]
  accessTokenHash: string
  accessExpiresAt: Date
  refreshTokenHash: string
  refreshExpiresAt: Date
}

export interface AuthorizationCodeGrant {
  codeHash: string
  clientId: string
  redirectUri: string
  resource: string
  scopes: readonly string[]
  codeChallenge: string
  grantId: string
  subject: string
  expiresAt: Date
}

export interface GrantStore {
  saveAuthorizationCode(code: AuthorizationCodeGrant): Promise<void>
  /**
   * Looks up the code and calls `redeem` with the record (or null when unknown) inside the
   * adapter's own transaction, holding a lock so concurrent exchanges cannot both succeed. If
   * `redeem` returns tokens, the adapter must persist them and mark the code spent atomically. If
   * it throws, no tokens may be persisted and the error must propagate; the adapter decides whether
   * a failed attempt spends the code. An already-spent code is passed with `replayed: true` so the
   * adapter can revoke what it issued.
   */
  redeemAuthorizationCode(
    codeHash: string,
    redeem: (record: AuthorizationCodeRecord | null) => IssuedTokens | Promise<IssuedTokens>,
  ): Promise<void>
  /** Same contract for refresh tokens: persist the rotated pair and spend the old token atomically. */
  redeemRefreshToken(
    tokenHash: string,
    redeem: (record: RefreshTokenRecord | null) => IssuedTokens | Promise<IssuedTokens>,
  ): Promise<void>
  /** Revoke the access or refresh token (and its family) when it belongs to `clientId`. */
  revokeToken(tokenHash: string, clientId: string): Promise<void>
}

export interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token: string
  scope: string
  token_type: 'Bearer'
}

export interface TokenLifetimes {
  authorizationCodeMs: number
  accessTokenMs: number
  refreshTokenMs: number
}

export interface TokenPrefixes {
  authorizationCode: string
  accessToken: string
  refreshToken: string
}
