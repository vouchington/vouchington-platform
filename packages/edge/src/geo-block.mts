export type GeoBlockHeaderNames = {
  /** Header proving the request transited the edge. Defaults to `cf-ray`. */
  edgePresence?: string
  /** Header carrying the ISO 3166-1 alpha-2 country. Defaults to `cf-ipcountry`. */
  country?: string
}

/**
 * Parses a comma-separated list of ISO 3166-1 alpha-2 country codes, for example from an
 * environment variable. Returns uppercase codes, or null when the value is empty (blocking off).
 */
export function parseBlockedCountries(value: string | undefined): Set<string> | null {
  const codes = (value ?? '').split(',').flatMap((code) => {
    const trimmed = code.trim()
    return trimmed ? [trimmed.toUpperCase()] : []
  })
  return codes.length > 0 ? new Set(codes) : null
}

/**
 * Returns true when the request should be geo-blocked. The edge-presence header marks a request
 * that transited the edge, so a missing country header is anomalous and fails closed. Without the
 * edge-presence header (local development, CI) the request is allowed.
 */
export function isGeoBlocked(
  headers: Headers,
  blockedCountries: ReadonlySet<string> | null,
  names: GeoBlockHeaderNames = {},
): boolean {
  if (!blockedCountries) return false
  if (!headers.get(names.edgePresence ?? 'cf-ray')) return false
  const country = headers.get(names.country ?? 'cf-ipcountry')
  return country ? blockedCountries.has(country.toUpperCase()) : true
}
