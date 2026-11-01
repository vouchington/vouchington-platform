import { describe, expect, it } from 'vitest'

import {
  buildAbsoluteUrl,
  createExcerpt,
  createNoIndexMetadata,
  createPageMetadata,
  createRobotsMetadata,
  createRootMetadata,
  getMarkdownAlternatePath,
} from './seo-metadata.mts'

const site = { siteName: 'Example', origin: 'https://example.com', description: 'Default.' }

describe('helpers', () => {
  it('builds absolute urls', () => {
    expect(buildAbsoluteUrl('https://example.com')).toBe('https://example.com/')
    expect(buildAbsoluteUrl('https://example.com', '/a?b=1')).toBe('https://example.com/a?b=1')
  })

  it('builds robots only for noindex', () => {
    expect(createRobotsMetadata(false)).toBeUndefined()
    expect(createRobotsMetadata(true)).toMatchObject({ index: false, googleBot: { follow: false } })
  })

  it('creates plain-text excerpts', () => {
    expect(createExcerpt('# Hi <b>there</b> *you*')).toBe('Hi there you')
    expect(createExcerpt('abcdefghij', 5)).toBe('abcd…')
  })

  it('keeps ordinary prose, decodes entities, and truncates by code point', () => {
    expect(createExcerpt('3 < 5 and 7 > 6, C++')).toBe('3 < 5 and 7 > 6, C++')
    expect(createExcerpt('Tom &amp; Jerry &#39;s &#x41; &nbsp;&bogus; &#0; &#x110000;')).toBe(
      "Tom & Jerry 's A &bogus; &#0; &#x110000;",
    )
    expect(createExcerpt('> quote\n## Head [link](http://x) ![img](y)')).toBe('quote Head link img')
    expect(createExcerpt(`${'a'.repeat(158)}😀😀😀`, 160)).toBe(`${'a'.repeat(158)}😀…`)
    expect(createExcerpt('😀😀😀', 2)).toBe('😀…')
  })

  it('handles quoted attributes, intraword markers, and non-positive limits', () => {
    expect(createExcerpt('<a title="1 > 0" href=\'x>y\'>link</a> after')).toBe('link after')
    expect(createExcerpt('snake_case and 5*3 and 2 ~ 3')).toBe('snake_case and 5*3 and 2 ~ 3')
    expect(createExcerpt('**bold _it_** ~~gone~~ `code` ***all***')).toBe('bold it gone code all')
    expect(createExcerpt('lone * star and ` tick')).toBe('lone * star and ` tick')
    expect(createExcerpt('abc', 0)).toBe('')
    expect(createExcerpt('abc', -3)).toBe('')
    expect(createExcerpt('abc', Number.NaN)).toBe('')
  })

  it('finds markdown alternates for listed prefixes', () => {
    const prefixes = new Set(['review'])
    expect(getMarkdownAlternatePath('/review/1', prefixes)).toBe('/review/1.md')
    expect(getMarkdownAlternatePath('/review/1/', prefixes)).toBe('/review/1.md')
    expect(getMarkdownAlternatePath('/other/1', prefixes)).toBeNull()
    expect(getMarkdownAlternatePath('/review', prefixes)).toBeNull()
  })
})

describe('createPageMetadata', () => {
  it('uses defaults', () => {
    const meta = createPageMetadata(site, {})
    expect(meta.metadataBase.href).toBe('https://example.com/')
    expect(meta.description).toBe('Default.')
    expect(meta.alternates).toEqual({ canonical: '/' })
    expect(meta.robots).toBeUndefined()
    expect(meta.openGraph).toEqual({
      type: 'website',
      siteName: 'Example',
      description: 'Default.',
      url: 'https://example.com/',
    })
    expect(meta.twitter).toEqual({ card: 'summary_large_image', description: 'Default.' })
  })

  it('builds a full article page', () => {
    const meta = createPageMetadata(site, {
      title: 'T',
      description: 'D',
      path: '/review/1',
      type: 'article',
      imageUrl: 'https://img/x.png',
      imageSize: { width: 1, height: 2 },
      publishedTime: 'p',
      modifiedTime: 'm',
      authors: ['a'],
      rssUrl: '/rss',
      openGraphLocale: 'en_US',
      markdownAlternatePath: '/review/1.md',
    })
    expect(meta.title).toBe('T')
    expect(meta.alternates?.types).toEqual({
      'text/markdown': [{ url: '/review/1.md', title: 'T Markdown' }],
      'application/rss+xml': '/rss',
    })
    expect(meta.openGraph).toMatchObject({
      locale: 'en_US',
      images: [{ url: 'https://img/x.png', width: 1, height: 2 }],
      publishedTime: 'p',
      modifiedTime: 'm',
      authors: ['a'],
    })
    expect(meta.twitter).toMatchObject({ title: 'T', images: ['https://img/x.png'] })
  })

  it('uses fallback image, default markdown title, and skips markdown for noindex', () => {
    const fallback = createPageMetadata(site, {
      fallbackImageUrl: 'https://img/f.png',
      markdownAlternatePath: '/a/b.md',
      type: 'article',
    })
    expect(fallback.openGraph).toMatchObject({
      images: [{ url: 'https://img/f.png', width: 1200, height: 630 }],
    })
    expect(fallback.alternates?.types).toEqual({
      'text/markdown': [{ url: '/a/b.md', title: 'Example Markdown' }],
    })
    const noindex = createPageMetadata(site, {
      noIndex: true,
      markdownAlternatePath: '/a/b.md',
      imageUrl: null,
      fallbackImageUrl: 'https://img/f.png',
    })
    expect(noindex.alternates?.types).toBeUndefined()
    expect(noindex.robots?.index).toBe(false)
    expect(noindex.openGraph).not.toHaveProperty('images')
  })
})

describe('other metadata', () => {
  it('builds noindex metadata', () => {
    expect(createNoIndexMetadata(site).title).toBeUndefined()
    expect(createNoIndexMetadata(site, 'T')).toMatchObject({
      title: 'T',
      description: 'Default.',
      robots: { index: false },
    })
  })

  it('builds root metadata', () => {
    const meta = createRootMetadata(site, {
      imageUrl: 'https://img/r.png',
      openGraphLocale: 'en_US',
      icons: { icon: [] },
    })
    expect(meta.title).toEqual({ default: 'Example', template: '%s | Example' })
    expect(meta.icons).toEqual({ icon: [] })
    expect(meta.openGraph).toMatchObject({ locale: 'en_US', url: 'https://example.com/' })
    const bare = createRootMetadata(site, { imageUrl: 'u', imageSize: { width: 1, height: 1 } })
    expect(bare).not.toHaveProperty('icons')
    const disabled = createRootMetadata(site, { imageUrl: 'u', icons: null })
    expect(disabled.icons).toBeNull()
    expect(bare.openGraph).not.toHaveProperty('locale')
  })
})
