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

export interface SeoMetadata {
  metadataBase: URL
  title?: string | { default: string; template: string }
  description: string
  alternates?: { canonical: string; types?: Record<string, unknown> }
  robots?: SeoRobots | undefined
  openGraph?: Record<string, unknown>
  twitter?: Record<string, unknown>
  [key: string]: unknown
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

function stripMarkup(value: string): string {
  return value
    .replace(/<[^>]+>/g, ' ')
    .replace(/[#*_`>[\]()+!]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function createExcerpt(value: string, maxLength: number = 160): string {
  const plainText = stripMarkup(value)
  if (plainText.length <= maxLength) return plainText
  return `${plainText.slice(0, maxLength - 1).trimEnd()}…`
}

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

/** Root layout metadata; icons are passed through untouched. */
export function createRootMetadata(
  site: SeoSite,
  options: {
    imageUrl: string
    openGraphLocale?: string | null
    icons?: Record<string, unknown>
    imageSize?: ImageSize
  },
): SeoMetadata {
  const size = options.imageSize ?? DEFAULT_IMAGE_SIZE
  return {
    metadataBase: new URL(site.origin),
    title: { default: site.siteName, template: `%s | ${site.siteName}` },
    description: site.description,
    alternates: { canonical: '/' },
    ...(options.icons ? { icons: options.icons } : {}),
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
