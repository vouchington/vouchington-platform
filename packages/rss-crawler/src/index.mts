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
  if (response.status === 304) {
    await cancelResponseBody(response)
    return { responseCode: 304, feed: null, contentSha256: null, headers }
  }
  if ([301, 302, 303, 307, 308].includes(response.status)) {
    const location = response.headers.get('location')
    await cancelResponseBody(response)
    if (!location) throw new Error(`Redirect response for ${url} has no Location header`)
    return {
      responseCode: response.status,
      feed: null,
      contentSha256: null,
      headers,
      redirect: {
        location: new URL(location, url).toString(),
        isPermanent: response.status === 301 || response.status === 308,
      },
    }
  }
  if (!response.ok) {
    await cancelResponseBody(response)
    throw new Error(`Feed request for ${url} failed with HTTP ${response.status}`)
  }
  const contentType = response.headers.get('content-type')
  if (contentType && !isFeedContentType(contentType)) {
    await cancelResponseBody(response)
    throw new TypeError(`Expected a feed content type, received ${contentType}`)
  }
  const body = await readResponseBody(response, maxBytes)
  const parsed = parseFeedDocument(body, { contentType })
  return {
    responseCode: response.status,
    feed: parsed.feed,
    contentSha256: parsed.contentSha256,
    headers,
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Cleanup must not replace the crawl outcome.
  }
}

async function readResponseBody(response: Response, maxBytes: number): Promise<Uint8Array> {
  const reader = response.body?.getReader()
  if (!reader) return new Uint8Array()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      length += value.byteLength
      if (length > maxBytes) {
        try {
          await reader.cancel()
        } catch {
          // Cleanup must not replace the size-limit error.
        }
        throw new RangeError(`Feed response exceeds ${maxBytes} bytes`)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const body = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function assertPositive(value: number, name: string): void {
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError(`${name} must be a positive safe integer`)
}
