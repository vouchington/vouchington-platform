export function buildQueryString(params: Record<string, unknown>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value == null) continue
    for (const item of Array.isArray(value) ? value : [value]) query.append(key, String(item))
  }
  const serialized = query.toString()
  return serialized ? `?${serialized}` : ''
}
