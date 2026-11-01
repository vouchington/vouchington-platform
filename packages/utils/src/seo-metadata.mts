export interface SeoSite {
  siteName: string
  /** Absolute origin, e.g. `https://example.com`. */
  origin: string
  description: string
}

export interface SeoRobots {
  index: false
  follow: false
  googleBot: { index: false; follow: false }
}

export interface SeoImage extends ImageSize {
  url: string
}

export interface SeoOpenGraph {
  type: 'website' | 'article'
  siteName: string
  title?: string
  description: string
  locale?: string
  url: string
  images?: SeoImage[]
  publishedTime?: string
  modifiedTime?: string
  authors?: string[]
}

export interface SeoTwitter {
  card: 'summary_large_image'
  title?: string
  description: string
  images?: string[]
}

export type SeoAlternateTypes = Record<string, string | { url: string; title?: string }[]>

/** Assignable to Next.js `Metadata` (the shapes below are subsets of its OpenGraph/Twitter types). */
export interface SeoMetadata {
  metadataBase: URL
  title?: string | { default: string; template: string }
  description: string
  alternates?: { canonical: string; types?: SeoAlternateTypes }
  robots?: SeoRobots | undefined
  openGraph?: SeoOpenGraph
  twitter?: SeoTwitter
}

export interface ImageSize {
  width: number
  height: number
}

export interface PageMetadataOptions {
  title?: string
  description?: string
  path?: string
  noIndex?: boolean
  /** Absolute image URL. `null` omits images; undefined uses `fallbackImageUrl`. */
  imageUrl?: string | null
  fallbackImageUrl?: string
  type?: 'website' | 'article'
  publishedTime?: string
  modifiedTime?: string
  authors?: string[]
  rssUrl?: string
  /** Resolved by the caller (for example `en_US`). */
  openGraphLocale?: string | null
  /** Resolved by the caller; ignored for noindex pages. */
  markdownAlternatePath?: string | null
  imageSize?: ImageSize
}

const DEFAULT_IMAGE_SIZE: ImageSize = { width: 1200, height: 630 }

export function buildAbsoluteUrl(origin: string, path: string = '/'): string {
  return new URL(path, origin).toString()
}

export function createRobotsMetadata(noIndex: boolean): SeoRobots | undefined {
  if (!noIndex) return undefined
  return { index: false, follow: false, googleBot: { index: false, follow: false } }
}

export { createExcerpt } from './seo-excerpt.mts'

/** Returns `${path}.md` when `path` is `/prefix/id` for a listed prefix. */
export function getMarkdownAlternatePath(
  path: string,
  prefixes: ReadonlySet<string>,
): string | null {
  const parts = path.split('/').filter(Boolean)
  if (parts.length !== 2) return null
  return prefixes.has(parts[0]!) ? `${path.replace(/\/$/, '')}.md` : null
}

export function createNoIndexMetadata(site: SeoSite, title?: string): SeoMetadata {
  return {
    metadataBase: new URL(site.origin),
    ...(title ? { title } : {}),
    description: site.description,
    robots: createRobotsMetadata(true),
  }
}

export function createPageMetadata(site: SeoSite, options: PageMetadataOptions): SeoMetadata {
  const { title, path = '/', noIndex = false, type = 'website' } = options
  const description = options.description ?? site.description
  const imageUrl =
    options.imageUrl === null ? undefined : (options.imageUrl ?? options.fallbackImageUrl)
  const size = options.imageSize ?? DEFAULT_IMAGE_SIZE
  const markdownPath = noIndex ? null : (options.markdownAlternatePath ?? null)
  const types = {
    ...(markdownPath
      ? { 'text/markdown': [{ url: markdownPath, title: `${title ?? site.siteName} Markdown` }] }
      : {}),
    ...(options.rssUrl ? { 'application/rss+xml': options.rssUrl } : {}),
  }
  const article =
    type === 'article'
      ? {
          ...(options.publishedTime ? { publishedTime: options.publishedTime } : {}),
          ...(options.modifiedTime ? { modifiedTime: options.modifiedTime } : {}),
          ...(options.authors?.length ? { authors: options.authors } : {}),
        }
      : {}
  return {
    metadataBase: new URL(site.origin),
    ...(title ? { title } : {}),
    description,
    alternates: {
      canonical: path,
      ...(Object.keys(types).length > 0 ? { types } : {}),
    },
    robots: createRobotsMetadata(noIndex),
    openGraph: {
      type,
      siteName: site.siteName,
      ...(title ? { title } : {}),
      description,
      ...(options.openGraphLocale ? { locale: options.openGraphLocale } : {}),
      url: buildAbsoluteUrl(site.origin, path),
      ...(imageUrl ? { images: [{ url: imageUrl, ...size }] } : {}),
      ...article,
    },
    twitter: {
      card: 'summary_large_image',
      ...(title ? { title } : {}),
      description,
      ...(imageUrl ? { images: [imageUrl] } : {}),
    },
  }
}

/** Root layout metadata; icons are passed through untouched; an explicit `null` disables default icons. */
export function createRootMetadata<Icons = never>(
  site: SeoSite,
  options: {
    imageUrl: string
    openGraphLocale?: string | null
    icons?: Icons | null
    imageSize?: ImageSize
  },
): SeoMetadata & { icons?: Icons | null } {
  const size = options.imageSize ?? DEFAULT_IMAGE_SIZE
  return {
    metadataBase: new URL(site.origin),
    title: { default: site.siteName, template: `%s | ${site.siteName}` },
    description: site.description,
    alternates: { canonical: '/' },
    ...(options.icons !== undefined ? { icons: options.icons } : {}),
    openGraph: {
      type: 'website',
      siteName: site.siteName,
      title: site.siteName,
      description: site.description,
      ...(options.openGraphLocale ? { locale: options.openGraphLocale } : {}),
      url: buildAbsoluteUrl(site.origin, '/'),
      images: [{ url: options.imageUrl, ...size }],
    },
    twitter: {
      card: 'summary_large_image',
      title: site.siteName,
      description: site.description,
      images: [options.imageUrl],
    },
  }
}
