import { invalidRedirectUri } from './errors.mts'

export const MAX_REDIRECT_URIS = 10
export const MAX_REDIRECT_URI_LENGTH = 2048

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]'])
const LOOPBACK_REQUEST = /^http:\/\/(127\.0\.0\.1|\[::1\]):([0-9]+)([/?].*)?$/u

/**
 * Validates registered redirect URIs: HTTPS or loopback HTTP, no wildcards, userinfo or fragments,
 * no duplicates. By default URIs are serialized; pass `serialize: false` to keep the exact strings
 * for simple string comparison.
 */
export function validateRedirectUris(
  values: unknown,
  options: { serialize?: boolean } = {},
): string[] {
  if (!Array.isArray(values) || values.length === 0 || values.length > MAX_REDIRECT_URIS) {
    throw invalidRedirectUri(
      `redirect_uris must contain between 1 and ${MAX_REDIRECT_URIS} entries`,
    )
  }
  const result: string[] = []
  for (const value of values) result.push(validateOne(value, options.serialize !== false))
  if (new Set(result).size !== result.length) {
    throw invalidRedirectUri('redirect_uris contains duplicates')
  }
  return result
}

function validateOne(value: unknown, serialize: boolean): string {
  if (
    typeof value !== 'string' ||
    value.length > MAX_REDIRECT_URI_LENGTH ||
    /[\s\p{Cc}\p{Z}]/u.test(value)
  ) {
    throw invalidRedirectUri('redirect_uris contains an invalid URI')
  }
  let uri: URL
  try {
    uri = new URL(value)
  } catch {
    throw invalidRedirectUri('redirect_uris contains an invalid URI')
  }
  if (value.includes('*')) throw invalidRedirectUri('redirect URIs cannot contain wildcards')
  if (uri.username || uri.password || uri.hash) {
    throw invalidRedirectUri('redirect URIs cannot contain userinfo or fragments')
  }
  const loopbackHttp = uri.protocol === 'http:' && LOOPBACK_HOSTNAMES.has(uri.hostname)
  if (uri.protocol !== 'https:' && !loopbackHttp) {
    throw invalidRedirectUri('redirect URIs must use HTTPS or loopback HTTP')
  }
  const redirectUri = serialize ? uri.toString() : value
  if (redirectUri.length > MAX_REDIRECT_URI_LENGTH) {
    throw invalidRedirectUri('redirect_uris contains an invalid URI')
  }
  return redirectUri
}

/**
 * Exact string match. RFC 8252 loopback registrations (127.0.0.1 and [::1]) may omit the ephemeral
 * port; every other part of the URI must still match exactly.
 */
export function matchesRegisteredRedirectUri(
  requestedUri: string,
  registeredUris: readonly string[],
): boolean {
  if (registeredUris.includes(requestedUri)) return true
  const requested = LOOPBACK_REQUEST.exec(requestedUri)
  if (!requested) return false
  if (Number(requested[2]) > 65_535) return false
  const suffix = requested[3] ?? ''
  // Registration serializes a portless root URI with a trailing slash.
  return (
    registeredUris.includes(`http://${requested[1]}${suffix}`) ||
    (suffix === '' && registeredUris.includes(`http://${requested[1]}/`))
  )
}
