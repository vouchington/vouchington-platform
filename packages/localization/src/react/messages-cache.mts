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
 * Per-locale catalog cache. `loadMessages` is injected (HTTP, bundled JSON, ...). A rejected load
 * stays cached until `invalidateMessages` so React's replay render sees the same thenable.
 */
export function createMessagesCache<C extends object>(
  loadMessages: (locale: string) => Promise<C>,
): MessagesCache<C> {
  const cache = new Map<string, Promise<C>>()
  const failed = new Set<string>()

  function seed(locale: string, messages: C): void {
    if (cache.has(locale) && !failed.has(locale)) return
    failed.delete(locale)
    cache.set(locale, createFulfilledThenable(cloneCatalog(messages)))
  }

  function merge(locale: string, incoming: C): void {
    const pending = cache.get(locale)
    if (!pending) {
      seed(locale, incoming)
      return
    }
    const tagged = pending as Partial<FulfilledThenable<C>>
    if (tagged.status === 'fulfilled' && tagged.value !== undefined) {
      mergeCatalogInPlace(
        tagged.value as Record<string, unknown>,
        incoming as Record<string, unknown>,
      )
      return
    }
    void pending.then(
      (existing) => {
        mergeCatalogInPlace(
          existing as Record<string, unknown>,
          incoming as Record<string, unknown>,
        )
      },
      () => {
        failed.delete(locale)
        cache.delete(locale)
        merge(locale, incoming)
      },
    )
  }

  function get(locale: string): Promise<C> {
    let promise = cache.get(locale)
    if (!promise) {
      const created = loadMessages(locale)
      promise = created
      cache.set(locale, created)
      void created.catch(() => {
        if (cache.get(locale) === created) failed.add(locale)
      })
    }
    return promise
  }

  function invalidate(locale: string): void {
    if (!failed.delete(locale)) return
    cache.delete(locale)
  }

  return {
    getMessagesPromise: get,
    invalidateMessages: invalidate,
    mergeMessages: merge,
    seedMessages: seed,
  }
}
