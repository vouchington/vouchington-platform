import { use, useMemo, type ReactNode } from 'react'

import type { MessagesCache } from './messages-cache.mts'

export interface TranslationsHookOptions<C extends object, T> {
  cache: Pick<MessagesCache<C>, 'getMessagesPromise'>
  /** Returns the active locale (for example from `createLocaleBindings().useLocale`). */
  useLocale: () => string
  /** Maps an arbitrary tag to a supported catalog locale, or undefined. */
  normalizeLocale: (locale: string) => string | undefined
  defaultLocale: string
  /** Builds the translator; message formatting and unresolved-key reporting stay injected. */
  createTranslator: (locale: string, messages: C) => T
}

/** Builds a hook that suspends on the locale's catalog and returns a memoized translator. */
export function createTranslationsHook<C extends object, T>(
  options: TranslationsHookOptions<C, T>,
): () => T {
  return function useTranslations(): T {
    const locale = options.normalizeLocale(options.useLocale()) ?? options.defaultLocale
    const messages = use(options.cache.getMessagesPromise(locale))
    return useMemo(() => options.createTranslator(locale, messages), [locale, messages])
  }
}

export interface CatalogHydratorProps<C extends object> {
  cache: Pick<MessagesCache<C>, 'mergeMessages'>
  locale: string
  catalog: C
  children?: ReactNode
}

/**
 * Merges a server-fetched catalog into the client cache during render so client navigations
 * see a route's messages before `useTranslations()` runs.
 */
export function CatalogHydrator<C extends object>({
  cache,
  locale,
  catalog,
  children,
}: CatalogHydratorProps<C>): ReactNode {
  cache.mergeMessages(locale, catalog)
  return children
}
