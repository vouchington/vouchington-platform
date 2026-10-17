const encoder = new TextEncoder()
const MAX_CACHED_LISTS = 16

/**
 * Compares every same-length credential with a byte-level XOR loop. Iterating the whole set avoids
 * revealing which credential matched. Length remains observable from the request header itself.
 */
export function timingSafeCredentialMatch(
  input: string,
  credentials: ReadonlySet<string>,
): boolean {
  const inputBytes = encoder.encode(input)
  let matched = false
  for (const credential of credentials) {
    const credentialBytes = encoder.encode(credential)
    if (inputBytes.length !== credentialBytes.length) continue
    let diff = 0
    for (let i = 0; i < inputBytes.length; i++) {
      diff |= (inputBytes[i] as number) ^ (credentialBytes[i] as number)
    }
    if (diff === 0) matched = true
  }
  return matched
}

export type BasicAuthCredentialList =
  | { status: 'absent' }
  | {
      status: 'configured'
      source: string
      credentials: Set<string>
      hasMalformedEntries: boolean
    }

export type RequiredBasicAuthDecision = 'authorized' | 'misconfigured' | 'unauthorized'

const credentialListCache = new Map<string, BasicAuthCredentialList>()

/**
 * Parses comma-separated `user:password` pairs (several entries support rotation). Usernames and
 * passwords must not contain commas and whitespace is significant. Parsed lists are memoized.
 */
export function readBasicAuthCredentialList(envValue: string | undefined): BasicAuthCredentialList {
  if (!envValue || envValue.trim() === '') return { status: 'absent' }
  const cached = credentialListCache.get(envValue)
  if (cached !== undefined) return cached

  const credentials = new Set<string>()
  let hasMalformedEntries = false
  for (const entry of envValue.split(',')) {
    const colonIndex = entry.indexOf(':')
    if (entry === '' || colonIndex <= 0 || colonIndex === entry.length - 1) {
      hasMalformedEntries = true
      continue
    }
    credentials.add(entry)
  }
  const result: BasicAuthCredentialList = {
    status: 'configured',
    source: envValue,
    credentials,
    hasMalformedEntries,
  }
  if (credentialListCache.size >= MAX_CACHED_LISTS) credentialListCache.clear()
  credentialListCache.set(envValue, result)
  return result
}

/** True when an `Authorization: Basic …` value decodes to one of `credentials`. */
export function basicAuthorizationMatches(
  authorization: string | null,
  credentials: ReadonlySet<string>,
): boolean {
  const match = authorization?.match(/^Basic\s+([A-Za-z0-9+/]+={0,2})$/i)
  if (!match) return false
  try {
    const decoded = Uint8Array.from(atob(match[1] as string), (character) =>
      character.charCodeAt(0),
    )
    return timingSafeCredentialMatch(new TextDecoder().decode(decoded), credentials)
  } catch {
    return false
  }
}

/** Fail-closed decision for routes that require Basic auth: absent or malformed config is an error. */
export function requiredBasicAuthDecision(
  authorization: string | null,
  envValue: string | undefined,
): RequiredBasicAuthDecision {
  const list = readBasicAuthCredentialList(envValue)
  if (list.status === 'absent' || list.hasMalformedEntries || list.credentials.size === 0) {
    return 'misconfigured'
  }
  return basicAuthorizationMatches(authorization, list.credentials) ? 'authorized' : 'unauthorized'
}
