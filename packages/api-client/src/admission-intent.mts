/** SHA-256 hex digest of the canonical intent, via Web Crypto. */
export async function fingerprintAdmissionIntent(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value)
  const digest = await crypto.subtle.digest('SHA-256', bytes)
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Serializes an intent with sorted keys, dropping `undefined` values and the application-supplied
 * transient fields (captcha tokens, honeypots) so retries of the same intent share one identity.
 */
export function canonicalizeAdmissionIntent(
  value: unknown,
  transientFields: ReadonlySet<string> = new Set(),
): string {
  return JSON.stringify(sortIntent(value, transientFields))
}

function sortIntent(value: unknown, transientFields: ReadonlySet<string>): unknown {
  // Honor JSON.stringify semantics for values such as Date that serialize through toJSON.
  if (hasToJSON(value)) return sortIntent(value.toJSON(), transientFields)
  if (Array.isArray(value)) return value.map((item) => sortIntent(item, transientFields))
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .filter(([key, entry]) => entry !== undefined && !transientFields.has(key))
        .toSorted(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, sortIntent(entry, transientFields)]),
    )
  }
  return value
}

function hasToJSON(value: unknown): value is { toJSON(): unknown } {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
  )
}
