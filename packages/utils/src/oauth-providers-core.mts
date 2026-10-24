import type { OAuthFetch, OAuthProfile } from './oauth-types.mts'

export interface OAuthCallContext {
  fetch: OAuthFetch
  signal?: AbortSignal
  /** Epoch milliseconds; defaults to `Date.now`. */
  now?: () => number
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  accessTokenExpiresAt?: Date
}

export interface AuthorizationCodeInput {
  code: string
  redirectUri: string
  codeVerifier?: string
}

export type OAuthProviderErrorKind = 'http' | 'provider_error' | 'malformed'

export class OAuthProviderError extends Error {
  readonly provider: string
  readonly kind: OAuthProviderErrorKind
  readonly status?: number
  constructor(provider: string, kind: OAuthProviderErrorKind, message: string, status?: number) {
    super(message)
    this.name = 'OAuthProviderError'
    this.provider = provider
    this.kind = kind
    if (status !== undefined) this.status = status
  }
}

export interface OAuthProvider {
  id: string
  redeem(
    input: AuthorizationCodeInput,
    ctx: OAuthCallContext,
  ): Promise<{ tokens: OAuthTokens; profile: OAuthProfile }>
}

export function nowOf(ctx: OAuthCallContext): () => number {
  return ctx.now ?? Date.now
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** A non-empty string, otherwise undefined. */
export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/** Drops undefined values so profile data only holds what the provider returned. */
export function compact(values: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(values).filter(([, value]) => value !== undefined))
}

export function asRecord(provider: string, value: unknown, label: string): Record<string, unknown> {
  if (isRecord(value)) return value
  throw new OAuthProviderError(provider, 'malformed', `${label} is not an object`)
}

export function requireCodeVerifier(provider: string, input: AuthorizationCodeInput): string {
  if (input.codeVerifier) return input.codeVerifier
  throw new OAuthProviderError(provider, 'malformed', 'A PKCE code verifier is required')
}

export function formBody(values: Record<string, string | undefined>): string {
  return new URLSearchParams(compact(values) as Record<string, string>).toString()
}

/** Fetches JSON through the injected transport; non-2xx and unparsable bodies throw. */
export async function requestJson(
  provider: string,
  label: string,
  ctx: OAuthCallContext,
  url: string,
  init: RequestInit = {},
): Promise<unknown> {
  // Token and profile requests carry credentials; never follow a redirect with them.
  const response = await ctx.fetch(url, {
    ...init,
    redirect: 'error',
    ...(ctx.signal ? { signal: ctx.signal } : {}),
  })
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined)
    throw new OAuthProviderError(
      provider,
      'http',
      `${label} failed: ${response.status}`,
      response.status,
    )
  }
  try {
    return await response.json()
  } catch {
    throw new OAuthProviderError(provider, 'malformed', `${label} returned invalid JSON`)
  }
}

function tokenErrorMessage(body: Record<string, unknown>): string | undefined {
  const { error } = body
  if (!error) return undefined
  if (typeof error === 'string') return str(body.error_description) ?? error
  return isRecord(error) ? (str(error.message) ?? 'Unknown error') : 'Unknown error'
}

/** Validates a token endpoint payload: `error` bodies and a missing access token throw. */
export function parseTokens(provider: string, payload: unknown, now: () => number): OAuthTokens {
  const body = asRecord(provider, payload, 'Token response')
  const message = tokenErrorMessage(body)
  if (message) {
    throw new OAuthProviderError(provider, 'provider_error', `Token exchange failed: ${message}`)
  }
  const accessToken = str(body.access_token)
  if (!accessToken) {
    throw new OAuthProviderError(provider, 'malformed', 'Token response is missing access_token')
  }
  const refreshToken = str(body.refresh_token)
  const expiresIn = body.expires_in
  return {
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
    ...(typeof expiresIn === 'number' && expiresIn > 0
      ? { accessTokenExpiresAt: new Date(now() + expiresIn * 1000) }
      : {}),
  }
}
