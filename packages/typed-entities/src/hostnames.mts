import { normalizeAsciiHostname } from '@vouchington/utils/urls'

import { HostnameClaimedError, InvalidHostnameClaimError, InvalidHostnameError } from './errors.mts'
import type { HostnameClaim, HostnameClaimPlan, HostnameKind, Normalizer } from './types.mts'

export function normalizeHostname(
  value: string,
  normalize: Normalizer = normalizeAsciiHostname,
): string {
  const hostname = normalize(value)
  if (!hostname) throw new InvalidHostnameError(value)
  return hostname
}

export function planHostnameClaim(input: {
  readonly entityId: string
  readonly value: string
  readonly kind: HostnameKind
  /** Existing exclusive claim on the requested hostname. */
  readonly requestedClaim: HostnameClaim | null
  /** Existing primary claim held by entityId. Additional claims may coexist. */
  readonly currentPrimary: HostnameClaim | null
  readonly mayReclaim?: boolean
  readonly normalize?: Normalizer
}): HostnameClaimPlan {
  const hostname = normalizeHostname(input.value, input.normalize)
  const claim = { entityId: input.entityId, hostname, kind: input.kind }
  const releases: HostnameClaim[] = []
  const current = input.requestedClaim

  if (current?.entityId === input.entityId) {
    if (current.kind === input.kind) return { claim, hostname, releases, write: false }
    if (input.kind === 'additional') {
      throw new InvalidHostnameClaimError(
        hostname,
        'a primary claim cannot be downgraded to additional; remove the primary claim first',
      )
    }
    releases.push(current)
  } else if (current !== null) {
    if (!input.mayReclaim) throw new HostnameClaimedError(hostname, current.entityId)
    releases.push(current)
  }

  if (
    input.kind === 'primary' &&
    input.currentPrimary !== null &&
    input.currentPrimary.hostname !== hostname
  ) {
    releases.push(input.currentPrimary)
  }
  return { claim, hostname, releases: uniqueClaims(releases), write: true }
}

function uniqueClaims(claims: readonly HostnameClaim[]): readonly HostnameClaim[] {
  return [...new Map(claims.map((claim) => [claim.hostname, claim])).values()].toSorted((a, b) =>
    a.hostname.localeCompare(b.hostname),
  )
}
