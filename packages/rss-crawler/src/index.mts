import { isFeedContentType, parseFeedDocument } from '@vouchington/rss-parser'
import type {
  CrawledFeed,
  CrawlFeedOptions,
  FeedRedirectResolver,
  FeedRedirectResolverContext,
  FeedResponseBodyReader,
  FeedResponseBodyReaderContext,
  FeedResponseErrorContext,
  FeedResponseErrorHandler,
} from './types.mts'

export type {
  CrawledFeed,
  CrawlFeedOptions,
  FeedRedirectResolver,
  FeedRedirectResolverContext,
  FeedResponseBodyReader,
  FeedResponseBodyReaderContext,
  FeedResponseErrorContext,
  FeedResponseErrorHandler,
  FeedTransport,
} from './types.mts'

const accept =
  'application/rss+xml, application/atom+xml, application/xml, text/xml, application/feed+json, application/json'

/** Fetches and parses one feed without choosing DNS, proxy, cache, or retry policy. */
export async function crawlFeed(url: string, options: CrawlFeedOptions): Promise<CrawledFeed> {
  assertPositive(options.timeoutMs ?? 10_000, 'timeoutMs')
  assertPositive(options.maxResponseSizeBytes ?? 10 * 1024 * 1024, 'maxResponseSizeBytes')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 10_000)
  try {
    const response = await options.transport.fetch(url, {
      headers: requestHeaders(options.headers, options.userAgent),
      signal: controller.signal,
    })
    return await handleResponse(url, response, {
      maxResponseSizeBytes: options.maxResponseSizeBytes ?? 10 * 1024 * 1024,
      responseBodyReader: options.responseBodyReader ?? readResponseBody,
      responseErrorHandler: options.responseErrorHandler,
      redirectResolver: options.redirectResolver ?? resolveRedirect,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timeout)
  }
}

function requestHeaders(
  callerHeaders: Record<string, string> | undefined,
  userAgent: string,
): Record<string, string> {
  const headers = new Headers(callerHeaders)
  headers.set('accept', accept)
  headers.set('user-agent', userAgent)
  return Object.fromEntries(headers)
}

async function handleResponse(
  url: string,
  response: Response,
  options: {
    maxResponseSizeBytes: number
    responseBodyReader: FeedResponseBodyReader
    responseErrorHandler: FeedResponseErrorHandler | undefined
    redirectResolver: FeedRedirectResolver
    signal: AbortSignal
  },
): Promise<CrawledFeed> {
  try {
    const headers = {
      etag: response.headers.get('etag'),
      lastModified: response.headers.get('last-modified'),
    }
    if (response.status === 304)
      return { responseCode: 304, feed: null, contentSha256: null, headers }
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      if (!location)
        failResponse(
          options.responseErrorHandler,
          {
            type: 'redirect',
            response,
            url,
            status: response.status,
            location,
          },
          new Error(`Redirect response for ${url} has no Location header`),
        )
      return {
        responseCode: response.status,
        feed: null,
        contentSha256: null,
        headers,
        redirect: {
          location: options.redirectResolver({ location, baseUrl: url }),
          isPermanent: response.status === 301 || response.status === 308,
        },
      }
    }
    if (!response.ok)
      failResponse(
        options.responseErrorHandler,
        { type: 'http', response, url, status: response.status },
        new Error(`Feed request for ${url} failed with HTTP ${response.status}`),
      )
    const contentType = response.headers.get('content-type')
    if (contentType && !isFeedContentType(contentType))
      failResponse(
        options.responseErrorHandler,
        { type: 'content-type', response, url, contentType },
        new TypeError(`Expected a feed content type, received ${contentType}`),
      )
    const body = await options.responseBodyReader({
      response,
      url,
      maxResponseSizeBytes: options.maxResponseSizeBytes,
      signal: options.signal,
    })
    const parsed = parseFeedDocument(body, { contentType })
    return {
      responseCode: response.status,
      feed: parsed.feed,
      contentSha256: parsed.contentSha256,
      headers,
    }
  } finally {
    await cancelResponseBody(response)
  }
}

function failResponse(
  handler: FeedResponseErrorHandler | undefined,
  context: FeedResponseErrorContext,
  fallback: Error,
): never {
  throw handler?.(context) ?? fallback
}

function resolveRedirect({ location, baseUrl }: FeedRedirectResolverContext): string {
  return new URL(location, baseUrl).toString()
}

async function cancelResponseBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Cleanup must not replace the crawl outcome.
  }
}

async function readResponseBody({
  response,
  maxResponseSizeBytes: maxBytes,
}: FeedResponseBodyReaderContext): Promise<Uint8Array> {
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
