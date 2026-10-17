import { createHash } from 'node:crypto'

import type { RateLimitIdentities } from './types.mts'

export interface BuildRateLimitKeysOptions {
  /** Dimensions whose value is replaced by a truncated SHA-256 so PII never reaches the backend. */
  hashedDimensions?: ReadonlySet<string> | undefined
}

/** Replaces characters that are unsafe in a Valkey key segment (hash-tag braces, whitespace). */
export function sanitizeRouteKeySegment(routeKey: string): string {
  return routeKey.replace(/[{}\s]/g, '_')
}

/**
 * Builds `{dimension}:{value}:{route}` keys, one per non-empty identity, in the object's key order.
 */
export function buildRateLimitKeys(
  routeKey: string,
  identities: RateLimitIdentities,
  options: BuildRateLimitKeysOptions = {},
): string[] {
  const routeSegment = sanitizeRouteKeySegment(routeKey)
  const keys: string[] = []
  for (const [dimension, value] of Object.entries(identities)) {
    if (!value) continue
    const id = options.hashedDimensions?.has(dimension) ? hashIdentity(value) : value
    keys.push(`${dimension}:${id}:${routeSegment}`)
  }
  return keys
}

function hashIdentity(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16)
}
