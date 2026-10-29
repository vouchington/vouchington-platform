import { ApiError } from './error.mts'
import { parseErrorResponseBody } from './error-body.mts'
import { buildQueryString, type QueryParams } from './query-string.mts'
import { appendQuery } from './request-parts.mts'

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'

export type RequestOptions = {
  method?: HttpMethod
  body?: unknown
  headers?: Record<string, string>
  signal?: AbortSignal
}

/** Per-call options for verbs whose method and body are fixed by the helper. */
export type VerbOptions = Pick<RequestOptions, 'headers' | 'signal'>

export type GetOptions = {
  searchParams?: QueryParams
  headers?: Record<string, string>
  signal?: AbortSignal
}

export type RequestBehavior = {
  /** Custom fetch implementation. Defaults to the global `fetch`. */
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  /** Receives non-fatal failures (such as body cancellation errors) for reporting. */
  onError?: (error: unknown) => void
  /**
   * Error codes on a 409 response that should carry `retry_after` like a 429 does. The
   * application owns the code catalog.
   */
  retryAfterConflictCodes?: readonly string[]
}

/** Verb helpers shared by the browser and server wrappers. Subclasses implement `request`. */
export abstract class RequestVerbs {
  abstract request<T>(endpoint: string, options?: RequestOptions): Promise<T>

  get<T>(endpoint: string, options: GetOptions = {}): Promise<T> {
    const { searchParams, ...rest } = options
    const queryString = searchParams ? buildQueryString(searchParams) : ''
    return this.request<T>(appendQuery(endpoint, queryString), rest)
  }

  post<T>(endpoint: string, body?: unknown, options?: VerbOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'POST', body })
  }

  put<T>(endpoint: string, body?: unknown, options?: VerbOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'PUT', body })
  }

  patch<T>(endpoint: string, body?: unknown, options?: VerbOptions): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'PATCH', body })
  }

  delete<T>(endpoint: string, options?: Omit<RequestOptions, 'method'>): Promise<T> {
    return this.request<T>(endpoint, { ...options, method: 'DELETE' })
  }
}

/** Runs a fetch and converts failures into `ApiError`, parsing JSON and tolerating empty bodies. */
export async function executeRequest<T>(
  url: string,
  method: HttpMethod,
  init: RequestInit,
  behavior: RequestBehavior,
): Promise<T> {
  try {
    const response = await (behavior.fetch ?? fetch)(url, init)
    if (!response.ok) throw await createApiError(response, behavior)
    const text = await response.text()
    return text.trim() ? (JSON.parse(text) as T) : (undefined as T)
  } catch (err) {
    if (err instanceof ApiError) throw err
    // A caller cancellation is not an API failure.
    if (err instanceof DOMException && err.name === 'AbortError') throw err
    throw new ApiError(
      `${err instanceof Error ? err.message : 'Unknown error'} (${method} ${url})`,
      500,
      err,
    )
  }
}

async function createApiError(response: Response, behavior: RequestBehavior): Promise<ApiError> {
  const errorData = await parseErrorResponseBody(
    response,
    behavior.onError ? { onError: behavior.onError } : {},
  )
  const carriesRetryAfter =
    response.status === 429 ||
    (response.status === 409 &&
      typeof errorData === 'object' &&
      errorData !== null &&
      'code' in errorData &&
      typeof errorData.code === 'string' &&
      behavior.retryAfterConflictCodes?.includes(errorData.code) === true)
  const message = `API request failed: ${response.statusText}`
  if (!carriesRetryAfter) return new ApiError(message, response.status, errorData)

  const parsed = parseInt(response.headers.get('Retry-After') ?? '', 10)
  const retry_after = parsed > 0 ? parsed : undefined
  const data =
    typeof errorData === 'object' && errorData !== null && !Array.isArray(errorData)
      ? { ...errorData, retry_after }
      : { retry_after }
  return new ApiError(message, response.status, data)
}
