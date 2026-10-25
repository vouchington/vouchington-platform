import type { OAuthProfile } from './oauth-types.mts'

export interface OidcClaims {
  iss: string
  aud: string | string[]
  sub: string
  exp: number
  iat: number
  nonce?: string
  email?: string
  email_verified?: boolean | string
  name?: string
  picture?: string
  given_name?: string
  family_name?: string
  [claim: string]: unknown
}

function isTrue(value: unknown): boolean {
  return value === true || value === 'true'
}

export function googleProfileFromClaims(claims: OidcClaims): OAuthProfile {
  const data: Record<string, unknown> = {}
  for (const key of ['name', 'email', 'picture', 'given_name', 'family_name'] as const) {
    if (claims[key]) data[key] = claims[key]
  }
  return {
    providerUserId: claims.sub,
    verifiedEmail: claims.email_verified === true ? (claims.email ?? null) : null,
    data,
  }
}

/** Microsoft verifies an email only when the signed domain-owner claim is boolean true. */
export function microsoftProfileFromClaims(claims: OidcClaims): OAuthProfile {
  const data: Record<string, unknown> = {}
  for (const key of ['name', 'email', 'given_name', 'family_name'] as const) {
    if (claims[key]) data[key] = claims[key]
  }
  const oid = claims.oid
  return {
    providerUserId: typeof oid === 'string' && oid.length > 0 ? oid : claims.sub,
    verifiedEmail: claims.xms_edov === true ? (claims.email ?? null) : null,
    data,
  }
}

/** Apple sends `email_verified` as a boolean or the string `'true'`. */
export function appleProfileFromClaims(
  claims: OidcClaims,
  userData?: { name?: string },
): OAuthProfile {
  const data: Record<string, unknown> = {}
  if (userData?.name) data.name = userData.name
  if (claims.email) data.email = claims.email
  return {
    providerUserId: claims.sub,
    verifiedEmail: isTrue(claims.email_verified) ? (claims.email ?? null) : null,
    data,
  }
}
