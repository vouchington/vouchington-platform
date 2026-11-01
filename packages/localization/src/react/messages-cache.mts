import { cloneCatalog, mergeCatalogInPlace } from './merge-catalog.mts'

export type FulfilledThenable<T> = Promise<T> & { status: 'fulfilled'; value: T }

export interface MessagesCache<C extends object> {
  getMessagesPromise: (locale: string) => Promise<C>
  invalidateMessages: (locale: string) => void
  mergeMessages: (locale: string, incoming: C) => void
  seedMessages: (locale: string, messages: C) => void
}

/**
 * Wraps a known value as a thenable React's `use()` reads synchronously on its first call.
 * A bare `Promise.resolve(value)` would suspend once; pre-tagging `status`/`value` mirrors what
 * `use()` writes after resolving, so seeded caches never suspend during hydration.
 */
export function createFulfilledThenable<T>(value: T): FulfilledThenable<T> {
  const thenable = Promise.resolve(value) as FulfilledThenable<T>
  thenable.status = 'fulfilled'
  thenable.value = value
  return thenable
}

/**
 * Per-locale catalog cache. `loadMessages` is injected (HTTP, bundled JSON, ...).
 *
 * Catalogs are never mutated after they are cached: a merge replaces the entry with a new
 * fulfilled catalog object, so memoized translators observe the identity change. Merging is
 * additive and idempotent. A rejected load stays cached until `invalidateMessages` so React's
 * replay render sees the same thenable.
 */
export function createMessagesCache<C extends object>(
  loadMessages: (locale: string) => Promise<C>,
): MessagesCache<C> {
  const cache = new Map<string, Promise<C>>()
  const failed = new WeakSet<Promise<C>>()

  function setFulfilled(locale: string, value: C): void {
    cache.set(locale, createFulfilledThenable(value))
  }

  function fulfilledValue(promise: Promise<C>): C | undefined {
    return (promise as Partial<FulfilledThenable<C>>).value
  }

  function seed(locale: string, messages: C): void {
    const current = cache.get(locale)
    if (current && fulfilledValue(current) !== undefined) return
    // Absent, pending, or failed: render from the bootstrap now; a pending load folds underneath.
    merge(locale, messages)
  }

  function mergedCopy(base: C, incoming: C): C {
    const copy = cloneCatalog(base)
    mergeCatalogInPlace(copy as Record<string, unknown>, incoming as Record<string, unknown>)
    return copy
  }

  function merge(locale: string, incoming: C): void {
    const current = cache.get(locale)
    const value = current ? fulfilledValue(current) : undefined
    if (value !== undefined) {
      setFulfilled(locale, mergedCopy(value, incoming))
      return
    }
    // Pending or failed: hydrate immediately from the incoming catalog, then fold the original
    // load underneath whatever has been merged by the time it settles.
    setFulfilled(locale, cloneCatalog(incoming))
    void current?.then(
      (loaded) => {
        // The entry is always fulfilled here: only failed entries are ever replaced or removed.
        const latest = cache.get(locale) as FulfilledThenable<C>
        setFulfilled(locale, mergedCopy(loaded, latest.value))
      },
      () => undefined,
    )
  }

  function get(locale: string): Promise<C> {
    let promise = cache.get(locale)
    if (!promise) {
      const created = loadMessages(locale)
      promise = created
      cache.set(locale, created)
      void created.catch(() => {
        failed.add(created)
      })
    }
    return promise
  }

  function invalidate(locale: string): void {
    const current = cache.get(locale)
    if (current && failed.has(current)) cache.delete(locale)
  }

  return {
    getMessagesPromise: get,
    invalidateMessages: invalidate,
    mergeMessages: merge,
    seedMessages: seed,
  }
}
