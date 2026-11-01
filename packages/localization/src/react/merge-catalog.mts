const UNSAFE_KEYS = new Set(['__proto__'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function cloneValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(cloneValue)
  if (isPlainObject(value)) {
    const copy: Record<string, unknown> = {}
    mergeCatalogInPlace(copy, value)
    return copy
  }
  return value
}

/**
 * Deep-merges `incoming` into `target`; arrays and scalars are replaced (arrays are cloned), objects are merged.
 * The `__proto__` key is skipped and only own properties of `target` are descended into.
 */
export function mergeCatalogInPlace(
  target: Record<string, unknown>,
  incoming: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(incoming)) {
    if (UNSAFE_KEYS.has(key)) continue
    if (isPlainObject(value)) {
      const existing = Object.hasOwn(target, key) ? target[key] : undefined
      const nested = isPlainObject(existing) ? existing : {}
      if (nested !== existing) target[key] = nested
      mergeCatalogInPlace(nested, value)
      continue
    }
    target[key] = cloneValue(value)
  }
}

export function cloneCatalog<C extends object>(incoming: C): C {
  const target: Record<string, unknown> = {}
  mergeCatalogInPlace(target, incoming as Record<string, unknown>)
  return target as C
}
