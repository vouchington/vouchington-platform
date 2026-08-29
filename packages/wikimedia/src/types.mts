export type WikimediaFetch = (url: string, init: RequestInit) => Promise<Response>

export interface WikimediaClientOptions {
  fetch: WikimediaFetch
  project: string
  language: string
  userAgent: string
  timeoutMs?: number
  maxRetryDelayMs?: number
}

export interface WikimediaSearchResult {
  pageId: number
  title: string
}

export interface WikimediaPageSummary {
  pageId: number
  title: string
  url: string
  extract: string | null
  description: string | null
  thumbnailUrl: string | null
}

export interface WikimediaClient {
  searchByTitle(
    query: string,
    options?: { limit?: number; signal?: AbortSignal },
  ): Promise<readonly WikimediaSearchResult[]>
  getPageSummary(
    title: string,
    options?: { signal?: AbortSignal },
  ): Promise<WikimediaPageSummary | null>
}
