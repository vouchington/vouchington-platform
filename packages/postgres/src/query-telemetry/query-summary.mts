/** One PostgreSQL query observed inside a profile scope. Times are `performance.now()` ms. */
export interface RequestQuery {
  annotation: string | null
  startMs: number
  endMs: number
  /**
   * Cursor-batch iteration, pipelined batches and transaction control are one logical statement,
   * not a repeated lookup.
   */
  excludedFromRepeats: boolean
  /**
   * Detached work (e.g. a background cache refresh) that the request never waits on: counted in
   * `totalQueries` but excluded from repeats and serial depth.
   */
  detached: boolean
}

export interface RepeatedAnnotation {
  annotation: string
  count: number
}

export interface RequestQuerySummary {
  totalQueries: number
  /** Largest set of queries that ran strictly one after another. */
  serialDepth: number
  repeats: RepeatedAnnotation[]
}

/**
 * Serial depth is the largest set of pairwise non-overlapping query intervals: the number of
 * round trips on the critical path. Queries overlapped by `Promise.all` count once. The classic
 * earliest-end-first greedy selection is optimal for this.
 */
export function computeSerialDepth(queries: readonly RequestQuery[]): number {
  const byEnd = queries.toSorted((left, right) => left.endMs - right.endMs)
  let depth = 0
  let chainEnd = Number.NEGATIVE_INFINITY
  for (const query of byEnd) {
    if (query.startMs < chainEnd) continue
    depth += 1
    chainEnd = query.endMs
  }
  return depth
}

/** Annotations that ran two or more times, most repeated first (ties by name). */
function findRepeatedAnnotations(queries: readonly RequestQuery[]): RepeatedAnnotation[] {
  const counts = new Map<string, number>()
  for (const query of queries) {
    if (query.excludedFromRepeats || query.detached) continue
    const annotation = query.annotation ?? 'unannotated'
    counts.set(annotation, (counts.get(annotation) ?? 0) + 1)
  }
  const repeats: RepeatedAnnotation[] = []
  for (const [annotation, count] of counts) {
    if (count >= 2) repeats.push({ annotation, count })
  }
  return repeats.toSorted(
    (left, right) => right.count - left.count || left.annotation.localeCompare(right.annotation),
  )
}

export function summarizeRequestQueries(queries: readonly RequestQuery[]): RequestQuerySummary {
  return {
    totalQueries: queries.length,
    serialDepth: computeSerialDepth(queries.filter((query) => !query.detached)),
    repeats: findRepeatedAnnotations(queries),
  }
}
