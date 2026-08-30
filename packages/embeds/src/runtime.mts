import { createRedirectingFetch } from '@vouchington/http-transport'

import type { EmbedResolverOptions, EmbedUrlPurpose, ResolveEmbedOptions } from './types.mts'

const DEFAULT_DOCUMENT_LIMIT = 10 * 1024 * 1024
const DEFAULT_OEMBED_LIMIT = 256 * 1024

export type Configuration = Required<
  Pick<
    EmbedResolverOptions,
    | 'fetch'
    | 'resolveDestination'
    | 'authorizeUrl'
    | 'userAgent'
    | 'maxRedirects'
    | 'maxDocumentSizeBytes'
    | 'maxOEmbedSizeBytes'
    | 'timeoutMs'
  >
> &
  Pick<EmbedResolverOptions, 'onOEmbedError'> & {
    providers: NonNullable<EmbedResolverOptions['providers']>
  }

export class EmbedPolicyError extends Error {
  constructor(purpose: EmbedUrlPurpose, url: URL) {
    super(`Embed policy denied ${purpose} URL: ${url.origin}`)
    this.name = 'EmbedPolicyError'
  }
}

export function normalizeOptions(options: EmbedResolverOptions): Configuration {
  if (!options.userAgent.trim()) throw new TypeError('userAgent must not be empty')
  return {
    ...options,
    providers: options.providers ?? [],
    maxRedirects: nonnegativeInteger(options.maxRedirects, 5),
    maxDocumentSizeBytes: positiveInteger(options.maxDocumentSizeBytes, DEFAULT_DOCUMENT_LIMIT),
    maxOEmbedSizeBytes: positiveInteger(options.maxOEmbedSizeBytes, DEFAULT_OEMBED_LIMIT),
    timeoutMs: positiveInteger(options.timeoutMs, 10_000),
  }
}

export function safeFetch(options: Configuration, purpose: EmbedUrlPurpose, sourceUrl: URL) {
  return createRedirectingFetch({
    fetch: options.fetch,
    maxRedirects: options.maxRedirects,
    resolveDestination: async (url, signal) => {
      await requireAuthorized(options, url, purpose, sourceUrl)
      return await options.resolveDestination(url, signal)
    },
  })
}

export async function requireAuthorized(
  options: Configuration,
  url: URL,
  purpose: EmbedUrlPurpose,
  sourceUrl: URL,
): Promise<void> {
  if (url.username || url.password || !(await options.authorizeUrl(url, { purpose, sourceUrl }))) {
    throw new EmbedPolicyError(purpose, url)
  }
}

export function requestInit(
  options: Configuration,
  signal: AbortSignal,
  accept: string,
): RequestInit {
  return { headers: { accept, 'user-agent': options.userAgent }, signal }
}

export function parseHttpUrl(input: string | URL): URL {
  const url = new URL(input)
  if ((url.protocol !== 'http:' && url.protocol !== 'https:') || url.username || url.password) {
    throw new TypeError('URL must use HTTP or HTTPS without credentials')
  }
  return url
}

export async function withTimeout<T>(
  timeoutMs: number,
  options: ResolveEmbedOptions | undefined,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = options?.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  return await operation(signal)
}

function positiveInteger(value: number | undefined, fallback: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result <= 0) {
    throw new RangeError('Limits must be positive safe integers')
  }
  return result
}

function nonnegativeInteger(value: number | undefined, fallback: number): number {
  const result = value ?? fallback
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new RangeError('maxRedirects must be a non-negative safe integer')
  }
  return result
}
