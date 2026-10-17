function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Deep-merges `incoming` into `target`; arrays and scalars are replaced, objects are merged. */
export function mergeCatalogInPlace(
  target: Record<string, unknown>,
  incoming: Record<string, unknown>,
): void {
  for (const [key, value] of Object.entries(incoming)) {
    if (isPlainObject(value)) {
      const existing = target[key]
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
