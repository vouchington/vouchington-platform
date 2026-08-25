export function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String)
  return typeof value === 'string'
    ? value.split(',').flatMap((item) => (item.trim() ? [item.trim()] : []))
    : []
}
export function parseBooleanish(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'number') return value !== 0
  return typeof value === 'string' && ['1', 'true'].includes(value.toLowerCase())
}
export function parseNumberParam(query: Record<string, unknown>, key: string): number | undefined {
  if (query[key] === undefined) return undefined
  const value = Number(query[key])
  return Number.isNaN(value) ? undefined : value
}
export function parseNumberParams(
  query: Record<string, unknown>,
  keys: readonly string[],
): Record<string, number> {
  return Object.fromEntries(
    keys.flatMap((key) => {
      const value = parseNumberParam(query, key)
      return value === undefined ? [] : [[key, value]]
    }),
  )
}
export function parseBoundedInteger(
  value: unknown,
  bounds: { default: number; minimum: number; maximum: number },
): number {
  if (
    !Number.isSafeInteger(bounds.default) ||
    !Number.isSafeInteger(bounds.minimum) ||
    !Number.isSafeInteger(bounds.maximum) ||
    bounds.minimum > bounds.maximum ||
    bounds.default < bounds.minimum ||
    bounds.default > bounds.maximum
  )
    throw new RangeError('Invalid integer bounds')
  if (value === undefined || value === null || value === '') return bounds.default
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : ''
  if (!/^-?\d+$/.test(text)) throw new TypeError('Expected a canonical integer')
  const parsed = Number(text)
  if (!Number.isSafeInteger(parsed)) throw new TypeError('Expected a safe integer')
  if (parsed < bounds.minimum || parsed > bounds.maximum)
    throw new RangeError(`Expected an integer between ${bounds.minimum} and ${bounds.maximum}`)
  return parsed
}
