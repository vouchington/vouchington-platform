export type JsonLd = Record<string, unknown>

export interface JsonLdContext {
  /** Resolves a site path to an absolute URL; injected so origin policy stays in the application. */
  absoluteUrl: (path: string) => string
}

export interface JsonLdSite extends JsonLdContext {
  siteName: string
}

export interface ItemListInput {
  name: string
  url: string
  description?: string
  image?: string
}

export const SCHEMA_ORG_CONTEXT = 'https://schema.org'
const CONTEXT = SCHEMA_ORG_CONTEXT

/** Escapes characters that could terminate an inline `<script>` or break JS parsing. */
export function escapeInlineScriptJson(json: string): string {
  return json
    .replace(/</g, '\\u003c')
    .replace(/>/g, '\\u003e')
    .replace(/&/g, '\\u0026')
    .replace(new RegExp('[\\u2028\\u2029]', 'g'), (char) => `\\u${char.charCodeAt(0).toString(16)}`)
}

export function serializeJsonLd(data: JsonLd): string {
  return escapeInlineScriptJson(JSON.stringify(data))
}

function webSiteRef(site: JsonLdSite): JsonLd {
  return { '@type': 'WebSite', name: site.siteName, url: site.absoluteUrl('/') }
}

function optional(key: string, value: string | undefined): JsonLd {
  return value ? { [key]: value } : {}
}

export function createOrganizationJsonLd(site: JsonLdSite, logoPath: string): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'Organization',
    name: site.siteName,
    url: site.absoluteUrl('/'),
    logo: site.absoluteUrl(logoPath),
  }
}

export function createWebSiteJsonLd(site: JsonLdSite): JsonLd {
  return { '@context': CONTEXT, ...webSiteRef(site) }
}

export function createSiteNavigationJsonLd(
  ctx: JsonLdContext,
  items: { name: string; path: string }[],
  name = 'Primary navigation',
): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'SiteNavigationElement',
    name,
    hasPart: items.map((item) => ({
      '@type': 'WebPage',
      name: item.name,
      url: ctx.absoluteUrl(item.path),
    })),
  }
}

export function createCollectionPageJsonLd(
  site: JsonLdSite,
  input: { title: string; description: string; path: string },
): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'CollectionPage',
    name: input.title,
    description: input.description,
    url: site.absoluteUrl(input.path),
    isPartOf: webSiteRef(site),
  }
}

export function createThingJsonLd(
  ctx: JsonLdContext,
  input: { name: string; description?: string; path: string; schemaOrgType?: string },
): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': input.schemaOrgType ?? 'Thing',
    name: input.name,
    ...optional('description', input.description),
    url: ctx.absoluteUrl(input.path),
  }
}

export function createWebPageJsonLd(
  site: JsonLdSite,
  input: { name: string; description?: string; path: string },
): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'WebPage',
    name: input.name,
    ...optional('description', input.description),
    url: site.absoluteUrl(input.path),
    isPartOf: webSiteRef(site),
  }
}

interface ComparedThing {
  name: string
  path: string
  schemaOrgType?: string
}

export function createComparisonPageJsonLd(
  site: JsonLdSite,
  input: { a: ComparedThing; b: ComparedThing; path: string },
): JsonLd {
  const about = (thing: ComparedThing): JsonLd => ({
    '@type': thing.schemaOrgType ?? 'Thing',
    name: thing.name,
    url: site.absoluteUrl(thing.path),
  })
  return {
    '@context': CONTEXT,
    '@type': 'WebPage',
    name: `${input.a.name} vs ${input.b.name}`,
    url: site.absoluteUrl(input.path),
    about: [about(input.a), about(input.b)],
    isPartOf: webSiteRef(site),
  }
}

export function createItemListJsonLd(
  ctx: JsonLdContext,
  items: ItemListInput[],
  listName: string,
): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'ItemList',
    name: listName,
    numberOfItems: items.length,
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      url: ctx.absoluteUrl(item.url),
      ...optional('description', item.description),
      ...(item.image ? { image: ctx.absoluteUrl(item.image) } : {}),
    })),
  }
}

/** Breadcrumb names are resolved by the caller (translation stays in the application). */
export function createBreadcrumbJsonLd(
  ctx: JsonLdContext,
  items: { name: string; path: string }[],
): JsonLd {
  return {
    '@context': CONTEXT,
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: ctx.absoluteUrl(item.path),
    })),
  }
}

export { createProfilePageJsonLd, resolveSchemaOrgType } from './json-ld-profile.mts'
