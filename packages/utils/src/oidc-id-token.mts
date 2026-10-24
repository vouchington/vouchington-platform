import { createHash, createPublicKey, createVerify } from 'node:crypto'
import type { OAuthFetch } from './oauth-types.mts'
import type { OidcClaims } from './oidc-id-token-profiles.mts'

export {
  appleProfileFromClaims,
  googleProfileFromClaims,
  type OidcClaims,
} from './oidc-id-token-profiles.mts'

export type OidcVerificationCode =
  | 'format'
  | 'alg'
  | 'key_not_found'
  | 'signature'
  | 'expired'
  | 'future_iat'
  | 'issuer'
  | 'audience'
  | 'nonce'
  | 'nonce_missing'
  | 'jwks_fetch'

export class OidcVerificationError extends Error {
  readonly code: OidcVerificationCode
  constructor(code: OidcVerificationCode, message: string) {
    super(message)
    this.name = 'OidcVerificationError'
    this.code = code
  }
}

export interface OidcIdTokenVerifierOptions {
  jwksUri: string
  issuers: readonly string[]
  /** Read on every verification so configuration can change at runtime. */
  audiences: () => readonly string[]
  fetch: OAuthFetch
  /** JWKS cache lifetime; defaults to one hour. */
  cacheTtlMs?: number
  /** Allowed `iat` skew in seconds; defaults to 300. */
  maxIatSkewSeconds?: number
  /** Minimum time between JWKS fetches triggered by an unknown `kid`; defaults to one minute. */
  refreshCooldownMs?: number
  now?: () => number
}

export interface OidcVerifyOptions {
  /** Raw nonce; compared with the `nonce` claim (hashed first when `nonceHash` is set). */
  nonce?: string
  nonceHash?: 'sha256-hex'
  signal?: AbortSignal
}

interface Jwk {
  kid?: string
  kty: string
  n: string
  e: string
}

function decodePart(part: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>
    }
  } catch {
    // Reported below as a format error.
  }
  throw new OidcVerificationError('format', 'ID token is malformed')
}

/** Rejects with the signal's reason when it aborts; the underlying promise keeps running. */
function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) return Promise.reject(signal.reason as Error)
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.finally(() => signal.removeEventListener('abort', onAbort)).then(resolve, reject)
  })
}

export function createOidcIdTokenVerifier(options: OidcIdTokenVerifierOptions) {
  const now = options.now ?? Date.now
  const ttl = options.cacheTtlMs ?? 60 * 60 * 1000
  const skew = options.maxIatSkewSeconds ?? 300
  const cooldown = options.refreshCooldownMs ?? 60 * 1000
  let keys: Promise<Jwk[]> | null = null
  let cachedAt = 0

  function loadKeys(forceRefresh: boolean): Promise<Jwk[]> {
    const age = now() - cachedAt
    // A forced refresh is skipped inside the cooldown, which also joins concurrent callers.
    if (keys && age < ttl && (!forceRefresh || age < cooldown)) return keys
    // The shared fetch ignores any caller's signal; callers cancel only their own wait.
    const pending = options
      .fetch(options.jwksUri)
      .then(async (response) => {
        if (!response.ok) {
          throw new OidcVerificationError('jwks_fetch', `JWKS request failed: ${response.status}`)
        }
        const body = (await response.json()) as { keys?: Jwk[] }
        if (!Array.isArray(body.keys)) {
          throw new OidcVerificationError('jwks_fetch', 'JWKS response has no keys')
        }
        return body.keys
      })
      .catch((error: unknown) => {
        keys = null
        throw error
      })
    cachedAt = now()
    keys = pending
    return pending
  }

  async function findKey(kid: unknown, signal?: AbortSignal): Promise<Jwk> {
    const match = (list: Jwk[]) => list.find((key) => key.kid === kid)
    const found = match(await abortable(loadKeys(false), signal))
    if (found) return found
    // The key may have rotated inside the cache window: refresh, at most once per cooldown.
    const refreshed = match(await abortable(loadKeys(true), signal))
    if (!refreshed) throw new OidcVerificationError('key_not_found', 'Signing key not found')
    return refreshed
  }

  function checkSignature(signed: string, signature: string, key: Jwk): void {
    let valid = false
    try {
      const publicKey = createPublicKey({
        key: { kty: key.kty, n: key.n, e: key.e },
        format: 'jwk',
      })
      valid = createVerify('SHA256')
        .update(signed)
        .verify(publicKey, Buffer.from(signature, 'base64url'))
    } catch {
      // An unusable key is reported as an invalid signature.
    }
    if (!valid) throw new OidcVerificationError('signature', 'ID token signature is invalid')
  }

  function checkClaims(claims: OidcClaims, verify: OidcVerifyOptions): void {
    if (typeof claims.exp !== 'number' || typeof claims.iat !== 'number') {
      throw new OidcVerificationError('format', 'ID token is missing exp or iat')
    }
    if (typeof claims.sub !== 'string' || claims.sub.length === 0) {
      throw new OidcVerificationError('format', 'ID token is missing sub')
    }
    const seconds = Math.floor(now() / 1000)
    if (claims.exp < seconds) throw new OidcVerificationError('expired', 'ID token has expired')
    if (claims.iat > seconds + skew) {
      throw new OidcVerificationError('future_iat', 'ID token was issued in the future')
    }
    if (!options.issuers.includes(claims.iss)) {
      throw new OidcVerificationError('issuer', 'ID token issuer is invalid')
    }
    const accepted = options.audiences()
    const presented = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
    if (!presented.some((audience) => accepted.includes(audience))) {
      throw new OidcVerificationError('audience', 'ID token audience is invalid')
    }
    if (verify.nonce === undefined) return
    if (!claims.nonce) throw new OidcVerificationError('nonce_missing', 'ID token has no nonce')
    const expected =
      verify.nonceHash === 'sha256-hex'
        ? createHash('sha256').update(verify.nonce).digest('hex')
        : verify.nonce
    if (claims.nonce !== expected) {
      throw new OidcVerificationError('nonce', 'ID token nonce is invalid')
    }
  }

  return {
    async verify(idToken: string, verify: OidcVerifyOptions = {}): Promise<OidcClaims> {
      const [header, payload, signature, ...rest] = idToken.split('.')
      if (!header || !payload || !signature || rest.length > 0) {
        throw new OidcVerificationError('format', 'ID token is malformed')
      }
      const { alg, kid } = decodePart(header)
      if (alg !== 'RS256') throw new OidcVerificationError('alg', 'Unsupported ID token algorithm')
      const key = await findKey(kid, verify.signal)
      checkSignature(`${header}.${payload}`, signature, key)
      const claims = decodePart(payload) as OidcClaims
      checkClaims(claims, verify)
      return claims
    },
  }
}
