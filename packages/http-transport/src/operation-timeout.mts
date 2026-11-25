import { isTimeoutError } from './error-handling.mts'

export const TRANSPORT_TIMEOUT_ERROR_CODES = Object.freeze([
  'ETIMEDOUT',
  'UND_ERR_BODY_TIMEOUT',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_HEADERS_TIMEOUT',
] as const)

const TRANSPORT_TIMEOUT_ERROR_CODE_SET = new Set<string>(TRANSPORT_TIMEOUT_ERROR_CODES)

export interface WithOperationTimeoutOptions {
  /** Fresh local timeout budget for this operation in milliseconds. */
  timeoutMs: number
  /** Optional parent signal; the operation aborts when either signal fires. */
  signal?: AbortSignal
  /** Maps transport timeouts (`isTransportTimeoutError`) to a caller-owned error. */
  mapTimeoutError?: (error: unknown) => Error
}

/**
 * True for `AbortError`, `TimeoutError`, or an error (or its `cause`) carrying a known Undici or
 * socket timeout code (`ETIMEDOUT`, `UND_ERR_*_TIMEOUT`).
 */
export function isTransportTimeoutError(error: unknown): boolean {
  if (isTimeoutError(error)) return true
  if (!(error instanceof Error)) return false
  const directCode = getErrorCode(error)
  if (directCode && TRANSPORT_TIMEOUT_ERROR_CODE_SET.has(directCode)) return true
  const causeCode = getErrorCode(error.cause)
  return causeCode !== undefined && TRANSPORT_TIMEOUT_ERROR_CODE_SET.has(causeCode)
}

/**
 * Creates a fresh local timeout signal, optionally composed with a parent signal so later stages
 * get their own deadline without outliving an enclosing request or worker budget.
 */
export function createOperationTimeoutSignal(
  timeoutMs: number,
  parentSignal?: AbortSignal,
): AbortSignal {
  const operationSignal = AbortSignal.timeout(timeoutMs)
  return parentSignal ? AbortSignal.any([parentSignal, operationSignal]) : operationSignal
}

/**
 * Races an async operation against an `AbortSignal`, preserving the exact `signal.reason` when the
 * signal aborts and cleaning up the listener once either side settles.
 */
export function raceWithAbortSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    void operation.catch(noop)
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- AbortSignal.reason is an arbitrary caller-provided value and must be preserved.
    return Promise.reject(signal.reason)
  }
  let removeAbortListener = noop
  const aborted = new Promise<never>((_resolve, reject) => {
    // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Preserve the exact AbortSignal.reason for callers.
    const onAbort = () => reject(signal.reason)
    signal.addEventListener('abort', onAbort, { once: true })
    removeAbortListener = () => signal.removeEventListener('abort', onAbort)
  })
  return Promise.race([operation, aborted]).finally(removeAbortListener)
}

/**
 * Runs an operation with a fresh timeout signal (composed with an optional parent signal), racing
 * against abort so operations that ignore `signal` still settle promptly, and optionally mapping
 * transport timeouts through `mapTimeoutError`.
 */
export function withOperationTimeout<T>(
  options: WithOperationTimeoutOptions,
  operation: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const signal = createOperationTimeoutSignal(options.timeoutMs, options.signal)
  return raceWithAbortSignal(operation(signal), signal).catch((error: unknown) => {
    if (options.mapTimeoutError && isTransportTimeoutError(error)) {
      throw options.mapTimeoutError(error)
    }
    throw error
  })
}

function getErrorCode(error: unknown): string | undefined {
  if (!(error instanceof Error)) return undefined
  const code = (error as Error & { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function noop(): void {}
