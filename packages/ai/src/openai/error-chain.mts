/** Cycle-safe walk down `cause`, returning the first non-null mapping. */
export function findInErrorChain<T>(error: unknown, map: (current: object) => T | null): T | null {
  const seen = new Set<unknown>()
  let current: unknown = error
  while (current !== null && (typeof current === 'object' || typeof current === 'function')) {
    if (seen.has(current)) return null
    seen.add(current)
    const mapped = map(current)
    if (mapped !== null) return mapped
    current = 'cause' in current ? current.cause : undefined
  }
  return null
}

/** True when `match` accepts any error in the `cause` chain. */
export function walkErrorChain(error: unknown, match: (current: object) => boolean): boolean {
  return findInErrorChain(error, (current) => (match(current) ? true : null)) ?? false
}
