import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import {
  Html,
  Text,
  copyrightYear,
  createEmailBundleOptions,
  createEmailStyles,
  createEmailTranslator,
  emailMessagesFromCatalog,
  emailOptional,
  formatLocalizationLeaf,
  interpolate,
  leavesFromCatalog,
  loadEmailCatalogMessages,
  render,
  renderEmail,
  resolveEmailLocale,
  DEFAULT_EMAIL_FONT_FAMILY,
} from './index.mts'
import type { EmailColors } from './index.mts'

const colors: EmailColors = {
  background: '#111',
  foreground: '#222',
  card: '#333',
  primary: '#444',
  primaryFg: '#555',
  muted: '#666',
  mutedFg: '#777',
  border: '#888',
}

describe('styles', () => {
  it('builds styles from injected tokens with defaults', () => {
    const styles = createEmailStyles({ colors })
    expect(styles.main).toEqual({ backgroundColor: '#111', fontFamily: DEFAULT_EMAIL_FONT_FAMILY })
    expect(styles.button.borderRadius).toBe('6px')
    expect(styles.footer.borderTop).toBe('1px solid #888')
    expect(styles.secondaryButton.border).toBe('1px solid #444')
  })

  it('honors overrides', () => {
    const styles = createEmailStyles({ colors, borderRadius: '0', fontFamily: 'serif' })
    expect(styles.main.fontFamily).toBe('serif')
    expect(styles.codeContainer.borderRadius).toBe('0')
  })

  it('formats the copyright year', () => {
    expect(copyrightYear(new Date(2031, 5, 1))).toBe('2031')
    expect(copyrightYear()).toBe(String(new Date().getFullYear()))
  })
})

describe('formatting', () => {
  it('interpolates known placeholders only', () => {
    expect(interpolate('Hi {name} {missing} {n}', { name: 'A', n: 2 })).toBe('Hi A {missing} 2')
  })

  it('formats plain strings', () => {
    expect(formatLocalizationLeaf('Hello {x}', 'en', { x: 1 })).toBe('Hello 1')
    expect(formatLocalizationLeaf('Hello', 'en')).toBe('Hello')
  })

  it('formats plurals with category and other fallback', () => {
    const leaf = {
      kind: 'plural',
      valueParameter: 'count',
      forms: { one: '{count} day', other: '{count} days' },
    } as const
    expect(formatLocalizationLeaf(leaf, 'en', { count: 1 })).toBe('1 day')
    expect(formatLocalizationLeaf(leaf, 'en', { count: 3 })).toBe('3 days')
    const sparse = { ...leaf, forms: { other: '{count} x' } } as const
    expect(formatLocalizationLeaf(sparse, 'en-US', { count: 1 })).toBe('1 x')
    expect(() => formatLocalizationLeaf(leaf, 'en', { count: 'nope' })).toThrow(/numeric "count"/)
  })

  it('formats select-plural cases', () => {
    const leaf = {
      kind: 'select-plural',
      valueParameter: 'count',
      selectParameter: 'kind',
      cases: {
        a: { one: 'a{count}', other: 'as{count}' },
        b: { other: 'b{count}' },
      },
    } as const
    expect(formatLocalizationLeaf(leaf, 'en', { count: 1, kind: 'a' })).toBe('a1')
    expect(formatLocalizationLeaf(leaf, 'en', { count: 1, kind: 'b' })).toBe('b1')
    expect(() => formatLocalizationLeaf(leaf, 'en', { count: 1, kind: 'z' })).toThrow(/no case "z"/)
    expect(() => formatLocalizationLeaf(leaf, 'en', { count: 1 })).toThrow(/no case ""/)
  })
})

const messages = emailMessagesFromCatalog({
  copies: [
    { id: 'c.hello', descriptor: null },
    { id: 'c.days', descriptor: { kind: 'plural', valueParameter: 'count' } },
    { id: 'c.only', descriptor: null },
    { id: 'c.other', descriptor: null },
  ],
  aliases: [
    { consumer: 'email', alias: 'email.welcome.heading', copyId: 'c.hello' },
    { consumer: 'email', alias: 'email.welcome.heading.unnamed', copyId: 'c.only' },
    { consumer: 'email', alias: 'email.welcome.days', copyId: 'c.days' },
    { consumer: 'web', alias: 'web.skip', copyId: 'c.other' },
  ],
  translations: {
    'en-US': [
      { id: 'c.hello', value: 'Hi {userName}' },
      { id: 'c.only', value: 'Hi there' },
      { id: 'c.days', value: { one: '{count} day', other: '{count} days' } },
      { id: 'c.other', value: 'x' },
    ],
    fr: [{ id: 'c.hello', value: 'Salut {userName}' }],
  },
})

describe('copy', () => {
  it('keeps only email aliases, sorted', () => {
    expect(messages.map((message) => message.id)).toEqual([
      'email.welcome.days',
      'email.welcome.heading',
      'email.welcome.heading.unnamed',
    ])
  })

  it('resolves leaves with en-US fallback', () => {
    expect(leavesFromCatalog(messages, 'fr')['email.welcome.heading']).toBe('Salut {userName}')
    expect(leavesFromCatalog(messages, 'fr')['email.welcome.heading.unnamed']).toBe('Hi there')
    expect(leavesFromCatalog(messages, 'en')['email.welcome.heading']).toBe('Hi {userName}')
    expect(leavesFromCatalog([{ ...messages[0]!, translations: {} }], 'en')).toEqual({})
  })

  it('translates by family and throws on missing keys', () => {
    const t = createEmailTranslator(leavesFromCatalog(messages, 'fr'), 'fr', 'welcome')
    expect(t('heading', { userName: 'Z' })).toBe('Salut Z')
    expect(t('days', { count: 2 })).toBe('2 days')
    expect(() => t('nope')).toThrow('Missing email message "email.welcome.nope"')
    expect(emailOptional(t, 'heading', 'Z')).toBe('Salut Z')
    expect(emailOptional(t, 'heading', '')).toBe('Hi there')
    expect(emailOptional(t, 'heading', undefined)).toBe('Hi there')
    expect(emailOptional(t, 'heading', 'Q', 'userName')).toBe('Salut Q')
  })
})

describe('catalog json loading', () => {
  const roots: string[] = []
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
  })

  function catalogDir(skip: string[] = [], tamper: Record<string, string> = {}): string {
    const root = mkdtempSync(join(tmpdir(), 'email-catalog-'))
    roots.push(root)
    const files: Record<string, unknown> = {
      'copies.json': [{ id: 'c.hello', descriptor: null }],
      'aliases.json': [{ consumer: 'email', alias: 'email.a.b', copyId: 'c.hello' }],
      'translations/fr.json': [{ id: 'c.hello', value: 'Salut' }],
      'translations/en-US.json': [{ id: 'c.hello', value: 'Hi' }],
      'translations/notes.txt': 'ignored',
    }
    mkdirSync(join(root, 'translations'))
    for (const [name, value] of Object.entries(files)) {
      if (skip.includes(name)) continue
      writeFileSync(join(root, name), tamper[name] ?? JSON.stringify(value))
    }
    return root
  }

  it('loads messages from a catalog directory', () => {
    const loaded = loadEmailCatalogMessages(catalogDir())
    expect(loaded).toEqual([
      {
        id: 'email.a.b',
        consumers: ['email'],
        descriptor: null,
        translations: { 'en-US': 'Hi', fr: 'Salut' },
      },
    ])
  })

  it('reports missing directories and files', () => {
    expect(() => loadEmailCatalogMessages(join(tmpdir(), 'email-missing-dir-xyz'))).toThrow(
      /directory is missing/,
    )
    expect(() => loadEmailCatalogMessages(catalogDir(['copies.json']))).toThrow(/JSON is missing/)
    const noTranslations = mkdtempSync(join(tmpdir(), 'email-catalog-'))
    roots.push(noTranslations)
    writeFileSync(join(noTranslations, 'copies.json'), '[]')
    writeFileSync(join(noTranslations, 'aliases.json'), '[]')
    expect(() => loadEmailCatalogMessages(noTranslations)).toThrow(/translations directory/)
    expect(() => loadEmailCatalogMessages(catalogDir([], { 'copies.json': '{}' }))).toThrow(
      /must be an array/,
    )
  })

  it('rejects dangling aliases and copies without translations', () => {
    const dangling = (alias: string, copies: unknown[], rows: unknown[]) =>
      emailMessagesFromCatalog({
        copies: copies as never,
        aliases: [{ consumer: 'email', alias, copyId: 'c.x' }],
        translations: { fr: rows as never },
      })
    expect(() => dangling('email.a', [], [])).toThrow(/references missing copy/)
    expect(() => dangling('email.a', [{ id: 'c.x', descriptor: null }], [])).toThrow(
      /has no translations/,
    )
  })
})

describe('locale', () => {
  const supported = ['en', 'es', 'pt-BR'] as const
  it('resolves exact, language, and fallback matches', () => {
    expect(resolveEmailLocale('es', supported, 'en')).toBe('es')
    expect(resolveEmailLocale('pt_br', supported, 'en')).toBe('pt-BR')
    expect(resolveEmailLocale('es-MX', supported, 'en')).toBe('es')
    expect(resolveEmailLocale('de', supported, 'en')).toBe('en')
    expect(resolveEmailLocale('en-GB', ['en', 'de'], 'de')).toBe('en')
    expect(resolveEmailLocale('!!', supported, 'en')).toBe('en')
    expect(resolveEmailLocale(null, supported, 'en')).toBe('en')
    expect(resolveEmailLocale(undefined, supported, 'en')).toBe('en')
  })
})

describe('rendering', () => {
  it('renders an element with caller-supplied subject and text', async () => {
    const element = createElement(Html, { lang: 'en' }, createElement(Text, null, 'Hello'))
    const result = await renderEmail({ subject: 'S', element, text: 'T' })
    expect(result.subject).toBe('S')
    expect(result.text).toBe('T')
    expect(result.html).toContain('Hello')
    expect(result.html).toContain('\n')
    const compact = await renderEmail({ subject: 'S', element, text: 'T', pretty: false })
    expect(compact.html).not.toContain('\n')
    expect(await render(element)).toContain('Hello')
  })
})

describe('bundle options', () => {
  it('builds esbuild options with defaults and overrides', () => {
    const defaults = createEmailBundleOptions({ entry: 'a.mts', outfile: 'b.mjs' })
    expect(defaults).toMatchObject({
      entryPoints: ['a.mts'],
      outfile: 'b.mjs',
      external: ['@vouchington/localization'],
      minify: true,
      format: 'esm',
    })
    const custom = createEmailBundleOptions({
      entry: 'a.mts',
      outfile: 'b.mjs',
      external: ['x'],
      minify: false,
    })
    expect(custom.external).toEqual(['x'])
    expect(custom.minify).toBe(false)
  })
})
