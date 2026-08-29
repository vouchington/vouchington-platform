import { decodeSearch, decodeSummary } from './decode.mts'
import { createWikimediaRequester } from './request.mts'
import type {
  WikimediaClient,
  WikimediaClientOptions,
  WikimediaPageSummary,
  WikimediaSearchResult,
} from './types.mts'

const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/

function requireLabel(name: string, value: string): void {
  if (!label.test(value)) throw new TypeError(`${name} must be a DNS label.`)
}

function requireMilliseconds(name: string, value: number): void {
  if (!Number.isFinite(value) || value < 0)
    throw new TypeError(`${name} must be a non-negative number.`)
}

function requireText(name: string, value: string): void {
  if (value.trim() === '') throw new TypeError(`${name} must not be empty.`)
}

function searchLimit(limit: number | undefined): number {
  if (limit === undefined) return 5
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100) {
    throw new TypeError('limit must be an integer between 1 and 100.')
  }
  return limit
}

export function createWikimediaClient(options: WikimediaClientOptions): WikimediaClient {
  requireLabel('project', options.project)
  requireLabel('language', options.language)
  requireText('userAgent', options.userAgent)
  const timeoutMs = options.timeoutMs ?? 10_000
  const maxRetryDelayMs = options.maxRetryDelayMs ?? 10_000
  requireMilliseconds('timeoutMs', timeoutMs)
  requireMilliseconds('maxRetryDelayMs', maxRetryDelayMs)
  const requester = createWikimediaRequester({
    fetch: options.fetch,
    timeoutMs,
    maxRetryDelayMs,
    userAgent: options.userAgent,
  })
  const summaryOrigin = `https://${options.language}.${options.project}.org`
  const coreOrigin = `https://api.wikimedia.org/core/v1/${options.project}/${options.language}`

  return {
    async searchByTitle(
      query: string,
      requestOptions = {},
    ): Promise<readonly WikimediaSearchResult[]> {
      requireText('query', query)
      const limit = searchLimit(requestOptions.limit)
      const url = `${coreOrigin}/search/title?q=${encodeURIComponent(query)}&limit=${limit}`
      return decodeSearch(await requester.getJson(url, requestOptions.signal), url)
    },
    async getPageSummary(title: string, requestOptions = {}): Promise<WikimediaPageSummary | null> {
      requireText('title', title)
      const encodedTitle = encodeURIComponent(title)
      const url = `${summaryOrigin}/api/rest_v1/page/summary/${encodedTitle}`
      const body = await requester.getJson(url, requestOptions.signal, true)
      return body === null ? null : decodeSummary(body, url, summaryOrigin)
    },
  }
}
