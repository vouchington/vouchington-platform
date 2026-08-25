export interface FeedTransport {
  fetch(
    url: string,
    options: { headers: Record<string, string>; signal: AbortSignal },
  ): Promise<Response>
}

export interface FeedResponseBodyReaderContext {
  readonly response: Response
  readonly url: string
  readonly maxResponseSizeBytes: number
  readonly signal: AbortSignal
}

export type FeedResponseBodyReader = (context: FeedResponseBodyReaderContext) => Promise<Uint8Array>

export type FeedResponseErrorContext =
  | {
      readonly type: 'http'
      readonly response: Response
      readonly url: string
      readonly status: number
    }
  | {
      readonly type: 'content-type'
      readonly response: Response
      readonly url: string
      readonly contentType: string
    }
  | {
      readonly type: 'redirect'
      readonly response: Response
      readonly url: string
      readonly status: number
      readonly location: string | null
    }

export type FeedResponseErrorHandler = (context: FeedResponseErrorContext) => Error | undefined

export interface FeedRedirectResolverContext {
  readonly location: string
  readonly baseUrl: string
}

export type FeedRedirectResolver = (context: FeedRedirectResolverContext) => string

export interface CrawlFeedOptions {
  transport: FeedTransport
  userAgent: string
  headers?: Record<string, string>
  timeoutMs?: number
  maxResponseSizeBytes?: number
  responseBodyReader?: FeedResponseBodyReader
  responseErrorHandler?: FeedResponseErrorHandler
  redirectResolver?: FeedRedirectResolver
}

export interface CrawledFeed {
  responseCode: number
  feed: import('@vouchington/rss-parser').ParsedFeed | null
  contentSha256: Uint8Array | null
  headers: { etag: string | null; lastModified: string | null }
  redirect?: { location: string; isPermanent: boolean }
}
