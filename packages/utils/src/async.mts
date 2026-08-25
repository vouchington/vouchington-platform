export async function mapWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  const count = Math.min(
    Math.max(1, Number.isFinite(concurrency) ? Math.floor(concurrency) : items.length),
    items.length,
  )
  const results: R[] = []
  let next = 0
  let failure: { reason: unknown } | undefined
  async function worker(): Promise<void> {
    const index = next++
    if (index >= items.length) return
    try {
      results[index] = await mapper(items[index]!)
    } catch (error) {
      failure ??= { reason: error }
    }
    return worker()
  }
  await Promise.allSettled(Array.from({ length: count }, worker))
  if (failure !== undefined) throw failure.reason
  return results
}
export function mapSerially<T, R>(
  items: readonly T[],
  mapper: (item: T) => Promise<R>,
): Promise<R[]> {
  return mapWithConcurrency(items, 1, mapper)
}
