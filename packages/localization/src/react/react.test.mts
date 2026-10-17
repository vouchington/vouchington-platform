// @vitest-environment jsdom
import { createElement, Suspense, type ReactNode } from 'react'
import { act, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import {
  CatalogHydrator,
  createLocaleBindings,
  createMessagesCache,
  createTranslationsHook,
  createUnresolvedMessageReporter,
  seedFromBootstrap,
} from './index.mts'

type Catalog = Record<string, string>
type Translator = (key: string) => string

const supported = new Set(['en', 'es'])
const normalizeLocale = (locale: string) => (supported.has(locale) ? locale : undefined)

function setup(load: (locale: string) => Promise<Catalog>) {
  const cache = createMessagesCache<Catalog>(load)
  const { LocaleProvider, useLocale } = createLocaleBindings('en')
  const createTranslator = vi.fn(
    (locale: string, messages: Catalog): Translator =>
      (key) =>
        `${locale}:${messages[key] ?? ''}`,
  )
  const useTranslations = createTranslationsHook<Catalog, Translator>({
    cache,
    useLocale,
    normalizeLocale,
    defaultLocale: 'en',
    createTranslator,
  })
  function Greeting() {
    return createElement('p', null, useTranslations()('hello'))
  }
  return { cache, LocaleProvider, createTranslator, Greeting, useLocale }
}

const suspense = (child: ReactNode) =>
  createElement(Suspense, { fallback: createElement('i', null, 'loading') }, child)

describe('locale bindings', () => {
  it('defaults and overrides the locale', () => {
    const { LocaleProvider, useLocale } = createLocaleBindings('en')
    function Show() {
      return createElement('span', null, useLocale())
    }
    const view = render(createElement(Show))
    expect(screen.getByText('en')).toBeTruthy()
    view.unmount()
    render(createElement(LocaleProvider, { locale: 'fr' }, createElement(Show)))
    expect(screen.getByText('fr')).toBeTruthy()
  })
})

describe('createTranslationsHook', () => {
  it('suspends on load then renders', async () => {
    const { Greeting } = setup(async () => ({ hello: 'hi' }))
    await act(async () => {
      render(suspense(createElement(Greeting)))
    })
    await waitFor(() => expect(screen.getByText('en:hi')).toBeTruthy())
  })

  it('renders synchronously from a seeded cache and falls back for unsupported locales', () => {
    const { cache, Greeting, LocaleProvider } = setup(() => Promise.reject(new Error('unused')))
    cache.seedMessages('en', { hello: 'seeded' })
    render(createElement(LocaleProvider, { locale: 'de-DE' }, suspense(createElement(Greeting))))
    expect(screen.getByText('en:seeded')).toBeTruthy()
  })

  it('uses the supported locale and memoizes the translator', () => {
    const { cache, Greeting, LocaleProvider, createTranslator } = setup(vi.fn())
    cache.seedMessages('es', { hello: 'hola' })
    const view = render(
      createElement(LocaleProvider, { locale: 'es' }, suspense(createElement(Greeting))),
    )
    expect(screen.getByText('es:hola')).toBeTruthy()
    view.rerender(
      createElement(LocaleProvider, { locale: 'es' }, suspense(createElement(Greeting))),
    )
    expect(createTranslator).toHaveBeenCalledTimes(1)
  })
})

describe('CatalogHydrator', () => {
  it('merges the catalog before children render', () => {
    const { cache, Greeting } = setup(vi.fn())
    render(
      createElement(
        CatalogHydrator<Catalog>,
        { cache, locale: 'en', catalog: { hello: 'merged' } },
        suspense(createElement(Greeting)),
      ),
    )
    expect(screen.getByText('en:merged')).toBeTruthy()
  })
})

describe('reporter and bootstrap', () => {
  it('reports each unresolved key once and returns an empty string', () => {
    const capture = vi.fn()
    const report = createUnresolvedMessageReporter('en', capture)
    expect(report('a.b')).toBe('')
    expect(report('a.b')).toBe('')
    expect(report('c.d')).toBe('')
    expect(capture).toHaveBeenCalledTimes(2)
    expect(capture.mock.calls[0]?.[1]).toEqual({
      tags: { i18n: 'unresolved-message', locale: 'en', key: 'a.b' },
      fingerprint: ['i18n-unresolved-message', 'en', 'a.b'],
    })
  })

  it('seeds from a bootstrap and ignores an absent one', () => {
    const seed = vi.fn()
    seedFromBootstrap(undefined, vi.fn(), seed)
    expect(seed).not.toHaveBeenCalled()
    seedFromBootstrap(
      { locale: 'es', catalog: [['k', 'v']] },
      (rows) => Object.fromEntries(rows),
      seed,
    )
    expect(seed).toHaveBeenCalledWith('es', { k: 'v' })
  })
})
