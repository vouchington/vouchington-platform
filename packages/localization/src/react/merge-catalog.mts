const UNSAFE_KEYS = new Set(['__proto__', 'constructor', 'prototype'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Deep-merges `incoming` into `target`; arrays and scalars are replaced, objects are merged.
 * Prototype-polluting keys are skipped and only own properties of `target` are descended into.
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
    target[key] = value
  }
}

export function cloneCatalog<C extends object>(incoming: C): C {
  const target: Record<string, unknown> = {}
  mergeCatalogInPlace(target, incoming as Record<string, unknown>)
  return target as C
}
