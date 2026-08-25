import { isFeedContentType, parseFeedDocument, type ParsedFeed } from '@vouchington/rss-parser'

const accept =
  'application/rss+xml, application/atom+xml, application/xml, text/xml, application/feed+json, application/json'

export interface FeedTransport {
  fetch(
    url: string,
    options: { headers: Record<string, string>; signal: AbortSignal },
  ): Promise<Response>
}

export interface CrawlFeedOptions {
  transport: FeedTransport
  userAgent: string
  headers?: Record<string, string>
  timeoutMs?: number
  maxResponseSizeBytes?: number
}

export interface CrawledFeed {
  responseCode: number
  feed: ParsedFeed | null
  contentSha256: Uint8Array | null
  headers: { etag: string | null; lastModified: string | null }
  redirect?: { location: string; isPermanent: boolean }
}

/** Fetches and parses one feed without choosing DNS, proxy, cache, or retry policy. */
export async function crawlFeed(url: string, options: CrawlFeedOptions): Promise<CrawledFeed> {
  assertPositive(options.timeoutMs ?? 10_000, 'timeoutMs')
  assertPositive(options.maxResponseSizeBytes ?? 10 * 1024 * 1024, 'maxResponseSizeBytes')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000)
  try {
    const response = await options.transport.fetch(url, {
      headers: { ...options.headers, 'User-Agent': options.userAgent, Accept: accept },
      signal: controller.signal,
    })
    return await handleResponse(url, response, options.maxResponseSizeBytes ?? 10 * 1024 * 1024)
  } finally {
    clearTimeout(timeout)
  }
}

async function handleResponse(
  url: string,
  response: Response,
  maxBytes: number,
): Promise<CrawledFeed> {
  const headers = {
    etag: response.headers.get('etag'),
    lastModified: response.headers.get('last-modified'),
  }
  if (response.status === 304)
    return { responseCode: 304, feed: null, contentSha256: null, headers }
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location')
    if (!location) throw new Error(`Redirect response for ${url} has no Location header`)
    return {
      responseCode: response.status,
      feed: null,
      contentSha256: null,
      headers,
      redirect: { location, isPermanent: response.status === 301 || response.status === 308 },
    }
  }
  if (!response.ok) throw new Error(`Feed request for ${url} failed with HTTP ${response.status}`)
  const contentType = response.headers.get('content-type')
  if (contentType && !isFeedContentType(contentType))
    throw new TypeError(`Expected a feed content type, received ${contentType}`)
  const body = new Uint8Array(await response.arrayBuffer())
  if (body.byteLength > maxBytes) throw new RangeError(`Feed response exceeds ${maxBytes} bytes`)
  const parsed = parseFeedDocument(body, { contentType })
  return {
    responseCode: response.status,
    feed: parsed.feed,
    contentSha256: parsed.contentSha256,
    headers,
  }
}

function assertPositive(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`${name} must be a positive safe integer`)
}
