export type QueryParams = Record<string, string | number | boolean | undefined>

/** Serializes defined params as `?a=1&b=2`, or an empty string when none remain. */
export function buildQueryString(params: QueryParams): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) query.append(key, String(value))
  }
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}
