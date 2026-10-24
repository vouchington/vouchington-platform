import { Keyset } from '@atproto/jwk'
import { JoseKey } from '@atproto/jwk-jose'

export type KeysetRuntimeMode = 'production' | 'development' | 'test'

export interface ParseEcKeysetOptions {
  /** Base64 JSON: an array of JWKs, a `{ keys }` document, or a single JWK. */
  env: string
  mode: KeysetRuntimeMode
  /** Used outside production when `env` is empty. Never read from the package. */
  fallbackKey?: object
  /** Named in error messages. */
  envName?: string
}

interface EcPrivateJwk {
  kty: 'EC'
  crv: 'P-256'
  d: string
  kid: string
  alg?: 'ES256'
}

type Importable = Parameters<typeof JoseKey.fromImportable>[0]

function decodeBase64Json(raw: string, envName: string): unknown {
  try {
    return JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as unknown
  } catch (error) {
    throw new Error(`${envName} must be valid base64-encoded JSON: ${(error as Error).message}`, {
      cause: error,
    })
  }
}

function unwrapKeys(parsed: unknown): unknown[] {
  if (Array.isArray(parsed)) return parsed
  const wrapped = (parsed as { keys?: unknown } | null)?.keys
  return Array.isArray(wrapped) ? wrapped : [parsed]
}

/** Requires EC P-256 private keys with a unique kid, since the SDK signs with ES256. */
function validateJwks(values: unknown[], envName: string): EcPrivateJwk[] {
  if (values.length === 0) throw new Error(`${envName} must contain at least one JWK`)
  const seen = new Set<string>()
  return values.map((value, index) => {
    const label = `${envName}[${index}]`
    if (typeof value !== 'object' || value === null) {
      throw new Error(`${label} must be a JSON object`)
    }
    const jwk = value as Partial<EcPrivateJwk>
    if (jwk.kty !== 'EC' || jwk.crv !== 'P-256') throw new Error(`${label} must be an EC P-256 JWK`)
    if (jwk.alg !== undefined && jwk.alg !== 'ES256') {
      throw new Error(`${label} must use ES256`)
    }
    if (typeof jwk.d !== 'string' || jwk.d.length === 0) {
      throw new Error(`${label} must be a private key (missing d)`)
    }
    if (typeof jwk.kid !== 'string' || jwk.kid.length === 0) {
      throw new Error(`${label} is missing kid`)
    }
    if (seen.has(jwk.kid)) throw new Error(`${envName} contains duplicate kid values: ${jwk.kid}`)
    seen.add(jwk.kid)
    return jwk as EcPrivateJwk
  })
}

async function buildKeyset(options: ParseEcKeysetOptions, envName: string): Promise<Keyset> {
  let jwks: EcPrivateJwk[]
  if (options.env.length > 0) {
    jwks = validateJwks(unwrapKeys(decodeBase64Json(options.env, envName)), envName)
  } else if (options.mode !== 'production' && options.fallbackKey) {
    jwks = validateJwks([options.fallbackKey], 'fallbackKey')
  } else {
    const suffix = options.mode === 'production' ? ' in production' : ''
    throw new Error(`${envName} must be configured${suffix}`)
  }
  return new Keyset(
    await Promise.all(jwks.map((jwk) => JoseKey.fromImportable({ ...jwk } as Importable, jwk.kid))),
  )
}

const cache = new Map<string, Promise<Keyset>>()

/**
 * Parses an AT Protocol signing keyset from a base64 JSON env value. Results are memoized per
 * mode, name, env value, and fallback key so every caller signs with the same keys.
 */
export function parseEcKeyset(options: ParseEcKeysetOptions): Promise<Keyset> {
  const envName = options.envName ?? 'ATPROTO_PRIVATE_KEYS_B64'
  const key = JSON.stringify([options.mode, envName, options.env, options.fallbackKey ?? null])
  const cached = cache.get(key)
  if (cached) return cached
  const keyset = buildKeyset(options, envName)
  cache.set(key, keyset)
  return keyset
}
