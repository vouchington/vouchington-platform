export function dedupeBy<T, K>(items: readonly T[], key: (item: T) => K): T[] {
  const seen = new Set<K>()
  return items.filter((item) => {
    const value = key(item)
    if (seen.has(value)) return false
    seen.add(value)
    return true
  })
}

export function dedupeByLast<T, K>(items: readonly T[], key: (item: T) => K): T[] {
  return [...new Map(items.map((item) => [key(item), item])).values()]
}

export function dedupeById<T extends { id: string }>(items: readonly T[]): T[] {
  return dedupeBy(items, (item) => item.id)
}

export function mergePageResultsById<T extends { id: string }>(
  pages?: readonly ({ results?: readonly T[] | null } | null | undefined)[] | null,
): T[] {
  return dedupeById((pages ?? []).flatMap((page) => page?.results ?? []))
}

export function mergeRecords<T, V>(
  pages: readonly T[],
  getRecord: (page: T) => Record<string, V>,
): Record<string, V> {
  const merged: Record<string, V> = {}
  for (const page of pages.toReversed()) {
    for (const [key, value] of Object.entries(getRecord(page))) {
      Object.defineProperty(merged, key, {
        configurable: true,
        enumerable: true,
        value,
        writable: true,
      })
    }
  }
  return merged
}
