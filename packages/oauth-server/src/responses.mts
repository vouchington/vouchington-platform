import type { OAuthProtocolError } from './errors.mts'

/** Headers every authorization-server response should carry. */
export const OAUTH_RESPONSE_HEADERS: Readonly<Record<string, string>> = {
  'Cache-Control': 'no-store',
  Pragma: 'no-cache',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

export interface OAuthErrorResponse {
  status: number
  headers: Record<string, string>
  body: { error: string; error_description: string }
}

/** RFC 6749 section 5.2 error response. A 401 invalid_client names the Basic challenge. */
export function buildOAuthErrorResponse(
  error: OAuthProtocolError,
  realm = 'token',
): OAuthErrorResponse {
  return {
    status: error.status,
    headers: {
      ...OAUTH_RESPONSE_HEADERS,
      ...(error.code === 'invalid_client' ? { 'WWW-Authenticate': `Basic realm="${realm}"` } : {}),
    },
    body: { error: error.code, error_description: error.message },
  }
}

/**
 * RFC 6749 section 4.1.2 / RFC 9207 authorization response URL. Always carries `iss` so a client
 * talking to several servers can reject a mixed-up response.
 */
export function buildAuthorizationResponseUrl(
  redirectUri: string,
  parameters: Readonly<Record<string, string>>,
  issuer: string,
): string {
  const redirect = new URL(redirectUri)
  for (const [name, value] of Object.entries(parameters)) redirect.searchParams.set(name, value)
  redirect.searchParams.set('iss', issuer)
  return redirect.toString()
}
