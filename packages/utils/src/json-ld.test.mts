import { describe, expect, it } from 'vitest'

import {
  createBreadcrumbJsonLd,
  createCollectionPageJsonLd,
  createComparisonPageJsonLd,
  createItemListJsonLd,
  createOrganizationJsonLd,
  createProfilePageJsonLd,
  createSiteNavigationJsonLd,
  createThingJsonLd,
  createWebPageJsonLd,
  createWebSiteJsonLd,
  escapeInlineScriptJson,
  resolveSchemaOrgType,
  serializeJsonLd,
} from './json-ld.mts'

const site = {
  siteName: 'Example',
  absoluteUrl: (path: string) => new URL(path, 'https://example.com').toString(),
}
const website = { '@type': 'WebSite', name: 'Example', url: 'https://example.com/' }

describe('serialization', () => {
  it('escapes script-breaking characters', () => {
    expect(escapeInlineScriptJson('</script>&\u2028\u2029')).toBe(
      '\\u003c/script\\u003e\\u0026\\u2028\\u2029',
    )
    expect(serializeJsonLd({ a: '</script>' })).toBe('{"a":"\\u003c/script\\u003e"}')
  })
})

describe('site schemas', () => {
  it('builds organization and website', () => {
    expect(createOrganizationJsonLd(site, '/icon.svg')).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: 'Example',
      url: 'https://example.com/',
      logo: 'https://example.com/icon.svg',
    })
    expect(createWebSiteJsonLd(site)).toEqual({ '@context': 'https://schema.org', ...website })
  })

  it('builds navigation with default and custom names', () => {
    const items = [{ name: 'Home', path: '/' }]
    const nav = createSiteNavigationJsonLd(site, items)
    expect(nav.name).toBe('Primary navigation')
    expect(nav.hasPart).toEqual([{ '@type': 'WebPage', name: 'Home', url: 'https://example.com/' }])
    expect(createSiteNavigationJsonLd(site, items, 'Footer').name).toBe('Footer')
  })

  it('builds collection and web pages', () => {
    expect(
      createCollectionPageJsonLd(site, { title: 'T', description: 'D', path: '/c' }),
    ).toMatchObject({ '@type': 'CollectionPage', name: 'T', isPartOf: website })
    const withDesc = createWebPageJsonLd(site, { name: 'N', description: 'D', path: '/p' })
    expect(withDesc).toMatchObject({ description: 'D', url: 'https://example.com/p' })
    expect(createWebPageJsonLd(site, { name: 'N', path: '/p' })).not.toHaveProperty('description')
  })
})

describe('entity schemas', () => {
  it('builds things with optional type and description', () => {
    expect(createThingJsonLd(site, { name: 'A', path: '/a' })).toEqual({
      '@context': 'https://schema.org',
      '@type': 'Thing',
      name: 'A',
      url: 'https://example.com/a',
    })
    expect(
      createThingJsonLd(site, { name: 'A', description: 'd', path: '/a', schemaOrgType: 'Book' }),
    ).toMatchObject({ '@type': 'Book', description: 'd' })
  })

  it('builds comparison pages', () => {
    const result = createComparisonPageJsonLd(site, {
      a: { name: 'A', path: '/a', schemaOrgType: 'Product' },
      b: { name: 'B', path: '/b' },
      path: '/compare/a-b',
    })
    expect(result.name).toBe('A vs B')
    expect(result.about).toEqual([
      { '@type': 'Product', name: 'A', url: 'https://example.com/a' },
      { '@type': 'Thing', name: 'B', url: 'https://example.com/b' },
    ])
  })

  it('builds item lists and breadcrumbs', () => {
    const list = createItemListJsonLd(
      site,
      [
        { name: 'One', url: '/1', description: 'd', image: '/i.png' },
        { name: 'Two', url: '/2' },
      ],
      'List',
    )
    expect(list.numberOfItems).toBe(2)
    expect(list.itemListElement).toEqual([
      {
        '@type': 'ListItem',
        position: 1,
        name: 'One',
        url: 'https://example.com/1',
        description: 'd',
        image: 'https://example.com/i.png',
      },
      { '@type': 'ListItem', position: 2, name: 'Two', url: 'https://example.com/2' },
    ])
    expect(createBreadcrumbJsonLd(site, [{ name: 'Home', path: '/' }]).itemListElement).toEqual([
      { '@type': 'ListItem', position: 1, name: 'Home', item: 'https://example.com/' },
    ])
  })
})

describe('profile pages', () => {
  it('builds a full profile', () => {
    const result = createProfilePageJsonLd(site, {
      username: 'u',
      displayName: 'Name',
      path: '/user/u',
      identifier: '1',
      imagePath: '/a.png',
      dateCreated: '2020-01-01',
      sameAs: ['https://x.example'],
    })
    expect(result).toMatchObject({ dateCreated: '2020-01-01' })
    expect(result.mainEntity).toEqual({
      '@type': 'Person',
      name: 'Name',
      alternateName: 'u',
      identifier: '1',
      url: 'https://example.com/user/u',
      image: 'https://example.com/a.png',
      sameAs: ['https://x.example'],
    })
  })

  it('omits optional fields', () => {
    const result = createProfilePageJsonLd(site, {
      username: 'u',
      displayName: 'u',
      path: '/user/u',
      identifier: '1',
      sameAs: [],
    })
    expect(result).not.toHaveProperty('dateCreated')
    expect(result.mainEntity).toEqual({
      '@type': 'Person',
      name: 'u',
      identifier: '1',
      url: 'https://example.com/user/u',
    })
    const bare = createProfilePageJsonLd(site, { username: 'u', path: '/x', identifier: '1' })
    expect(bare.mainEntity).toMatchObject({ name: 'u' })
  })
})

describe('resolveSchemaOrgType', () => {
  const mapping = { books: 'Book', movies: 'Movie' }
  it('returns the first mapped type', () => {
    expect(resolveSchemaOrgType(['x', 'movies', 'books'], mapping)).toBe('Movie')
  })
  it('falls back and ignores inherited keys', () => {
    expect(resolveSchemaOrgType(['toString'], mapping)).toBe('Thing')
    expect(resolveSchemaOrgType([], mapping, 'Other')).toBe('Other')
  })
})
