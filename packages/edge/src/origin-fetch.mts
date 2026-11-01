import { edgeErrorResponse } from './error-response.mts'

const IDEMPOTENT_METHODS = new Set(['GET', 'HEAD'])
export const DROPPED_SOCKET_PATTERN =
  /network connection lost|connection reset by peer|ECONNRESET|ECONNREFUSED|EPIPE|UND_ERR_SOCKET/i

export type OriginFetchOptions = {
  /** Defaults to global `fetch`; inject a service binding's fetch or a test double. */
  fetch?: (request: Request) => Promise<Response>
  /** Receives the final error before the 502 is produced. */
  onError?: (error: unknown) => void
  /** Overrides which errors are safe to retry once on a fresh connection. */
  isRetryable?: (error: unknown) => boolean
}

export type OriginFetchResult = { duration: number; response: Response } | { error: Response }

const MAX_CAUSE_DEPTH = 5

/** Undici rejects with `TypeError: fetch failed` and the socket error in `cause`. */
function isDroppedSocket(error: unknown): boolean {
  let current = error
  for (let depth = 0; depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (typeof current !== 'object' || current === null) return false
    const { message, code, cause } = current as Record<string, unknown>
    if (current instanceof Error && DROPPED_SOCKET_PATTERN.test(message as string)) return true
    if (typeof code === 'string' && DROPPED_SOCKET_PATTERN.test(code)) return true
    current = cause
  }
  return false
}

/**
 * Fetches an origin request. GET and HEAD are retried once after a dropped socket; mutating
 * methods are single-attempt because a lost response may already have been applied. Failures
 * become a no-store 502 under `error`.
 */
export async function fetchOriginResponse(
  originRequest: Request,
  options: OriginFetchOptions = {},
): Promise<OriginFetchResult> {
  const send = options.fetch ?? fetch
  const isRetryable = options.isRetryable ?? isDroppedSocket
  const start = Date.now()
  const canRetry = IDEMPOTENT_METHODS.has(originRequest.method.toUpperCase())
  const failure = (error: unknown): { error: Response } => {
    options.onError?.(error)
    return { error: edgeErrorResponse(502, 'Bad Gateway', 'BAD_GATEWAY') }
  }
  // Clone first so a retry still has an unread request.
  const firstRequest = canRetry ? originRequest.clone() : originRequest
  try {
    const response = await send(firstRequest)
    return { duration: Date.now() - start, response }
  } catch (error) {
    if (!canRetry || !isRetryable(error)) return failure(error)
  }
  try {
    const response = await send(originRequest)
    return { duration: Date.now() - start, response }
  } catch (error) {
    return failure(error)
  }
}
