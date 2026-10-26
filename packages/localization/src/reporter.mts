export type UnresolvedMessageCapture = (
  error: Error,
  context: { tags: Record<string, string>; fingerprint: string[] },
) => void

/**
 * Returns an `onUnresolved` callback that reports each missing key once per locale and renders
 * an empty string. `capture` is injected (for example an error tracker).
 */
export function createUnresolvedMessageReporter(
  locale: string,
  capture: UnresolvedMessageCapture,
): (key: string) => string {
  const reported = new Set<string>()
  return (key) => {
    if (!reported.has(key)) {
      reported.add(key)
      capture(new Error(`Unresolvable message key "${key}"`), {
        tags: { i18n: 'unresolved-message', locale, key },
        fingerprint: ['i18n-unresolved-message', locale, key],
      })
    }
    return ''
  }
}

export interface MessagesBootstrap<S> {
  locale: string
  catalog: S
}

/**
 * Seeds a cache from a server-serialized bootstrap object. `deserialize` restores the catalog
 * shape; an absent bootstrap is a no-op.
 */
export function seedFromBootstrap<S, C extends object>(
  bootstrap: MessagesBootstrap<S> | undefined,
  deserialize: (catalog: S) => C,
  seed: (locale: string, catalog: C) => void,
): void {
  if (!bootstrap) return
  seed(bootstrap.locale, deserialize(bootstrap.catalog))
}
