import {
  executeRequest,
  RequestVerbs,
  serializeBody,
  type RequestBehavior,
  type RequestOptions,
} from './request-core.mts'

export type ClientRequestConfig = RequestBehavior & {
  /** Prefix for every endpoint. Defaults to '' so endpoints are same-origin relative URLs. */
  baseUrl?: string
  /** Injected auth headers, resolved per request. Per-call headers override them. */
  headers?: () => Record<string, string> | Promise<Record<string, string>>
  /** Fetch credentials mode. Defaults to 'include' so cookies are sent. */
  credentials?: 'include' | 'same-origin' | 'omit'
}

/** Browser JSON request wrapper. Base URL, auth headers, and conflict codes are injected. */
export class ClientRequest extends RequestVerbs {
  readonly #config: ClientRequestConfig

  constructor(config: ClientRequestConfig = {}) {
    super()
    this.#config = config
  }

  async request<T>(endpoint: string, options: RequestOptions = {}): Promise<T> {
    const { method = 'GET', body, headers = {}, signal } = options
    const url = `${this.#config.baseUrl ?? ''}${endpoint}`
    const init: RequestInit = {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(await this.#config.headers?.()),
        ...headers,
      },
      credentials: this.#config.credentials ?? 'include',
      ...(signal ? { signal } : {}),
    }
    serializeBody(init, method, body)
    return executeRequest<T>(url, method, init, this.#config)
  }
}
