export const SENSITIVE_VALUE = '[Filtered]'

/** Return from a {@link transformRecord} callback to omit the entry. */
export const DROP: unique symbol = Symbol('drop')

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Copy-on-write entry mapping: returns the input when no entry changed. Rebuilds with
 * `Object.fromEntries` so keys such as `__proto__` stay own data properties.
 */
export function transformRecord<T extends object>(
  record: T,
  transform: (key: string, value: unknown) => unknown,
): T {
  let changed = false
  const entries: Array<[string, unknown]> = []
  for (const [key, value] of Object.entries(record)) {
    const next = transform(key, value)
    if (next === DROP) {
      changed = true
    } else {
      if (!Object.is(next, value)) changed = true
      entries.push([key, next])
    }
  }
  return changed ? (Object.fromEntries(entries) as T) : record
}
