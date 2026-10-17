import { createContext, createElement, use, type Context, type ReactNode } from 'react'

export interface LocaleBindings {
  LocaleContext: Context<string>
  LocaleProvider: (props: { children?: ReactNode; locale: string }) => ReactNode
  useLocale: () => string
}

/** Creates a locale context, provider, and hook. The default locale is injected. */
export function createLocaleBindings(defaultLocale: string): LocaleBindings {
  const LocaleContext = createContext<string>(defaultLocale)
  return {
    LocaleContext,
    LocaleProvider: ({ children, locale }) =>
      createElement(LocaleContext.Provider, { value: locale }, children),
    useLocale: () => use(LocaleContext),
  }
}
