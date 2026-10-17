import { DROP, isRecord, transformRecord } from './observability-records.mts'

export interface UrlScrubOptions {
  /** Extra caller-owned redaction applied after the query string and fragment are stripped. */
  redactUrl?: (url: string) => string
}

/** Span, breadcrumb, and request attribute keys whose string value is a URL. */
export const URL_ATTRIBUTE_KEYS: readonly string[] = Object.freeze([
  'url',
  'url.full',
  'http.url',
  'http.target',
  'http.request.header.referer',
  'http.request.header.referrer',
])
/** Attribute keys whose value is only a query string or fragment; they are dropped. */
export const URL_COMPONENT_ATTRIBUTE_KEYS: readonly string[] = Object.freeze([
  'url.query',
  'http.query',
  'url.fragment',
  'http.fragment',
])
/** Every attribute key the URL scrubber rewrites or drops. */
export const SCRUBBED_URL_ATTRIBUTE_KEYS: readonly string[] = Object.freeze([
  ...URL_ATTRIBUTE_KEYS,
  ...URL_COMPONENT_ATTRIBUTE_KEYS,
])

export function stripUrlQueryAndFragment(value: string): string {
  const match = /[?#]/.exec(value)
  return match ? value.slice(0, match.index) : value
}

function scrubUrl(value: string, options: UrlScrubOptions): string {
  const stripped = stripUrlQueryAndFragment(value)
  return options.redactUrl ? options.redactUrl(stripped) : stripped
}

/** Scrub a string or each string item of an array; other values and clean arrays pass through. */
export function scrubUrlValue(value: unknown, options: UrlScrubOptions = {}): unknown {
  if (typeof value === 'string') return scrubUrl(value, options)
  if (!Array.isArray(value)) return value
  const items = value.map((item: unknown) =>
    typeof item === 'string' ? scrubUrl(item, options) : item,
  )
  return items.some((item, index) => !Object.is(item, value[index])) ? items : value
}

function isUrlHeader(name: string): boolean {
  const lower = name.toLowerCase()
  return lower === 'referer' || lower === 'referrer'
}

/** Strip query strings and fragments from URL attributes and drop query/fragment-only keys. */
export function scrubSpanUrlAttributes<T extends Record<string, unknown>>(
  data: T,
  options: UrlScrubOptions = {},
): T {
  return transformRecord(data, (key, value) => {
    if (URL_COMPONENT_ATTRIBUTE_KEYS.includes(key)) return DROP
    return URL_ATTRIBUTE_KEYS.includes(key) ? scrubUrlValue(value, options) : value
  })
}

/** Scrub the `referer`/`referrer` header values of a headers record. */
export function scrubHeaderUrls(
  headers: Record<string, unknown>,
  options: UrlScrubOptions = {},
): Record<string, unknown> {
  return transformRecord(headers, (name, value) =>
    isUrlHeader(name) ? scrubUrlValue(value, options) : value,
  )
}

/** Drop `query_string`, strip `url`, and scrub URL-bearing headers on an event request. */
export function scrubRequestUrlFields<T extends object>(
  request: T | undefined,
  options: UrlScrubOptions = {},
): T | undefined {
  if (!request) return request
  return transformRecord(request, (key, value) => {
    if (key === 'query_string') return DROP
    if (key === 'url' && typeof value === 'string') return scrubUrl(value, options)
    return key === 'headers' && isRecord(value) ? scrubHeaderUrls(value, options) : value
  })
}
