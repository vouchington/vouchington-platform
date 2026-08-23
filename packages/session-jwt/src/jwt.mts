import * as jose from 'jose'
import { JWT_ALGORITHM, type JwtKeySet } from './keys.mts'

type JwtConfiguration = {
  keySet: JwtKeySet
  issuer: string
  audience: string | readonly string[]
}
export type JwtSignOptions = JwtConfiguration & {
  expiresIn: string | number | Date
  issuedAt?: number
}
export type JwtVerifyOptions = JwtConfiguration & {
  clockTolerance?: number
}
export type ValidatedJwtVerifyOptions<TPayload extends jose.JWTPayload> = JwtVerifyOptions & {
  validatePayload: (payload: jose.JWTPayload) => payload is TPayload
}
type InternalJwtVerifyOptions = JwtVerifyOptions & {
  validatePayload?: (payload: jose.JWTPayload) => boolean
}

export async function signJwt(payload: jose.JWTPayload, options: JwtSignOptions): Promise<string> {
  const audience = validateConfiguration(options)
  validateSignTimes(options)
  const key = options.keySet.privateKeys[0]
  if (!key) throw new Error('JWT signing requires a private JWK')
  return new jose.SignJWT(payload)
    .setProtectedHeader({ alg: JWT_ALGORITHM, kid: key.jwk.kid })
    .setIssuedAt(options.issuedAt)
    .setIssuer(options.issuer)
    .setAudience(audience)
    .setExpirationTime(options.expiresIn)
    .sign(key.cryptoKey)
}

export function decodeJwt(token: string): jose.JWTPayload | null {
  try {
    return jose.decodeJwt(token)
  } catch {
    return null
  }
}

export function verifyJwt<TPayload extends jose.JWTPayload>(
  token: string,
  options: ValidatedJwtVerifyOptions<TPayload>,
): Promise<TPayload | null>
export function verifyJwt(token: string, options: JwtVerifyOptions): Promise<jose.JWTPayload | null>
export async function verifyJwt(
  token: string,
  options: InternalJwtVerifyOptions,
): Promise<jose.JWTPayload | null> {
  const audience = validateConfiguration(options)
  validateClockTolerance(options.clockTolerance)
  let kid: string | undefined
  try {
    kid = jose.decodeProtectedHeader(token).kid
  } catch {
    return null
  }
  const candidates =
    typeof kid === 'string'
      ? options.keySet.publicKeys.filter((key) => key.jwk.kid === kid)
      : options.keySet.publicKeys
  if (candidates.length === 0) return null
  try {
    return await Promise.any(
      candidates.map(async (key) => {
        const { payload } = await jose.jwtVerify(token, key.cryptoKey, {
          issuer: options.issuer,
          audience,
          algorithms: [JWT_ALGORITHM],
          ...(options.clockTolerance === undefined
            ? {}
            : { clockTolerance: options.clockTolerance }),
        })
        if (options.validatePayload && !options.validatePayload(payload))
          throw new Error('Invalid JWT payload')
        return payload
      }),
    )
  } catch {
    return null
  }
}

function validateClockTolerance(clockTolerance: number | undefined): void {
  if (clockTolerance !== undefined && (!Number.isFinite(clockTolerance) || clockTolerance < 0))
    throw new Error('JWT clock tolerance must be a non-negative finite number of seconds')
}

function validateConfiguration(options: JwtConfiguration): string | string[] {
  if (typeof options.issuer !== 'string' || options.issuer.trim().length === 0)
    throw new Error('JWT issuer must be a non-empty string')
  const audience = typeof options.audience === 'string' ? [options.audience] : options.audience
  if (
    !Array.isArray(audience) ||
    audience.length === 0 ||
    audience.some((value) => typeof value !== 'string' || value.trim().length === 0)
  )
    throw new Error('JWT audience must contain non-empty strings')
  return typeof options.audience === 'string' ? options.audience : [...audience]
}

function validateSignTimes(options: JwtSignOptions): void {
  const validExpiration =
    (typeof options.expiresIn === 'string' && options.expiresIn.trim().length > 0) ||
    (typeof options.expiresIn === 'number' && Number.isFinite(options.expiresIn)) ||
    (options.expiresIn instanceof Date && Number.isFinite(options.expiresIn.getTime()))
  if (!validExpiration) throw new Error('JWT expiration must be a valid string, number, or Date')
  if (options.issuedAt !== undefined && !Number.isFinite(options.issuedAt))
    throw new Error('JWT issued-at time must be finite')
}
