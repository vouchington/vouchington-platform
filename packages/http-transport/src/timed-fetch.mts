import { fetch as undiciFetch, type Dispatcher } from 'undici'
import type { ResolvedSafeAddress } from 'ssrf-guard'

export interface FetchWithTimeoutOptions {
  url: string
  headers: Record<string, string>
  /** Bounds DNS, connect, request send and response headers. Cleared once `fetch` settles. */
  requestTimeoutMs: number
  /** Bounds the body download. The clock starts when headers arrive. */
  responseTimeoutMs: number
  signal?: AbortSignal
  /** Pre-validated addresses. Pins the connection to them, closing the check-to-fetch gap. */
  resolvedAddresses?: ResolvedSafeAddress[]
  /** Dispatcher source, typically the result of `createHttpDispatchers()`. */
  dispatchers: {
    getExternalRequestDispatcher(): Dispatcher
    getPinnedRequestDispatcher(addresses: ResolvedSafeAddress[]): Dispatcher
  }
}

export interface FetchWithTimeoutResult {
  response: Response
  /** Armed once headers arrive. Thread it into whatever reads the body. */
  responseSignal: AbortSignal
}

/**
 * Fetches with independent request-phase and body-phase timeouts and `redirect: 'manual'`.
 * The phases are not a divided shared budget: a fast request leaves the body its full budget.
 */
export async function fetchWithTimeout(
  options: FetchWithTimeoutOptions,
): Promise<FetchWithTimeoutResult> {
  const { url, headers, requestTimeoutMs, responseTimeoutMs, resolvedAddresses, signal } = options
  const dispatcher = resolvedAddresses?.length
    ? options.dispatchers.getPinnedRequestDispatcher(resolvedAddresses)
    : options.dispatchers.getExternalRequestDispatcher()

  const requestController = new AbortController()
  const requestTimer = setTimeout(
    () =>
      requestController.abort(
        new DOMException('The operation was aborted due to timeout', 'TimeoutError'),
      ),
    requestTimeoutMs,
  )
  try {
    const requestSignal = signal
      ? AbortSignal.any([requestController.signal, signal])
      : requestController.signal
    const response = await undiciFetch(url, {
      dispatcher,
      headers,
      signal: requestSignal,
      redirect: 'manual',
    })
    const timeoutSignal = AbortSignal.timeout(responseTimeoutMs)
    const responseSignal = signal ? AbortSignal.any([timeoutSignal, signal]) : timeoutSignal
    // Undici's Response and the ambient Response are the same runtime object with skewed types.
    return { response: response as unknown as Response, responseSignal }
  } finally {
    clearTimeout(requestTimer)
  }
}

/** One timeout over the whole call, for small one-shot fetches such as robots.txt. */
export async function fetchWithTimeoutSimple(
  url: string,
  timeoutMs: number,
  dispatcher: Dispatcher,
): Promise<Response> {
  const response = await undiciFetch(url, { dispatcher, signal: AbortSignal.timeout(timeoutMs) })
  return response as unknown as Response
}
