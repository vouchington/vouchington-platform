import {
  executeRequest,
  RequestVerbs,
  type HttpMethod,
  type RequestBehavior,
  type RequestOptions,
} from './request-core.mts'
import { applyBody, mergeHeaders } from './request-parts.mts'

export type ServerHeaderContext = {
  method: HttpMethod
  url: string
  /** Headers supplied by the caller for this request. */
  headers: Readonly<Record<string, string>>
}

export type ServerRequestConfig = RequestBehavior & {
  /** Absolute API origin, or a resolver evaluated per request. */
  baseUrl: string | (() => string)
  /**
   * Injected headers (forwarded cookies, request ids, client info, shared secrets) merged after
   * the caller's headers. Return nothing to add no headers.
   */
  resolveHeaders?: (
    context: ServerHeaderContext,
  ) => Record<string, string> | Promise<Record<string, string>>
  /** Extra fetch init, such as `{ cache: 'no-store' }` for Next.js. */
  fetchInit?: RequestInit
}

/**
 * Server-side JSON request wrapper. Non-GET requests that carry a `Cookie` header also send an
 * `Origin` header derived from the request URL, so cookie-authenticated mutations pass origin checks.
 */
export class ServerRequest extends RequestVerbs {
  readonly #config: ServerRequestConfig

  constructor(config: ServerRequestConfig) {
    super()
    this.#config = config
  }

  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {}, signal } = options
    const { baseUrl } = this.#config
    const url = `${typeof baseUrl === 'function' ? baseUrl() : baseUrl}${endpoint}`
    const injected = await this.#config.resolveHeaders?.({ method, url, headers })
    let merged = mergeHeaders(headers, injected)
    if (method !== 'GET' && Object.keys(merged).some((name) => name.toLowerCase() === 'cookie')) {
      merged = mergeHeaders(merged, { Origin: new URL(url).origin })
    }
    const init: RequestInit = {
      ...this.#config.fetchInit,
      method,
      ...(signal ? { signal } : {}),
    }
    applyBody(init, method, body, merged)
    return executeRequest<T>(url, method, init, this.#config)
  }
}
