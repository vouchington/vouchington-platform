import { APIConnectionError, APIError, APIUserAbortError, RateLimitError } from 'openai'
import { parseRetryAfter, readHeader } from '../providers/http.mts'
import { findInErrorChain, walkErrorChain } from './error-chain.mts'
import { OpenAIResponseNotCompletedError, OpenAIResponseStreamIterationError } from './response.mts'

/** What a tolerated upstream failure was, so a skip stays attributable in logs. */
export type OpenAIUpstreamFailure = {
  readonly reason: string
  readonly status?: number
  readonly requestId?: string | undefined
  readonly code?: string | undefined
}

/** Statuses OpenAI's own SDK retry predicate treats as transient (404 is handled separately). */
const TRANSIENT_STATUSES = new Set([408, 409, 429])
const FLEX_RESOURCE_UNAVAILABLE = /resource[\s_-]*unavailable/i
const FLEX_CAPACITY_FAILURE = /flex processing is temporarily unavailable/i

export function isOpenAIRateLimitError(error?: unknown): boolean {
  if (error instanceof RateLimitError) return true
  return error instanceof APIError && error.status === 429
}

/** Transient server errors (5xx); Responses calls treat these as accounting-ambiguous. */
export function isOpenAIServerError(error?: unknown): boolean {
  return error instanceof APIError && error.status >= 500
}

/**
 * The flex/priority-tier 429 returned when no capacity is available (`resource_unavailable`).
 * OpenAI never started processing it, so it is not billed and a retry is free.
 */
export function isOpenAIFlexResourceUnavailableError(error?: unknown): boolean {
  if (!(error instanceof APIError) || error.status !== 429) return false
  if (typeof error.code === 'string' && FLEX_RESOURCE_UNAVAILABLE.test(error.code)) return true
  return FLEX_RESOURCE_UNAVAILABLE.test(error.message)
}

/**
 * The streamed form of flex capacity unavailability: a `response.failed` with `server_error`,
 * "Flex processing is temporarily unavailable", and no usage. Unbilled; any usage makes it billable.
 */
export function isOpenAIFlexCapacityFailedResponseError(error: unknown): boolean {
  return (
    error instanceof OpenAIResponseNotCompletedError &&
    error.status === 'failed' &&
    error.code === 'server_error' &&
    error.usage == null &&
    FLEX_CAPACITY_FAILURE.test(error.message)
  )
}

/** The caller's own abort, as opposed to the provider failing. */
export function isExplicitClientCancelError(error: unknown): boolean {
  return walkErrorChain(error, (current) => {
    if (current instanceof APIUserAbortError) return true
    return current instanceof Error && current.name === 'AbortError'
  })
}

/** A deterministic, unbilled rejection of a `previous_response_id` the provider no longer has. */
export function isOpenAIMissingPreviousResponseError(error: unknown): boolean {
  return walkErrorChain(
    error,
    (current) =>
      current instanceof APIError &&
      (current.status === 400 || current.status === undefined) &&
      current.code === 'previous_response_not_found' &&
      current.param === 'previous_response_id',
  )
}

/** A 404: a response id past its retention window, or one that never existed. */
export function isOpenAINotFoundError(error: unknown): boolean {
  return error instanceof APIError && error.status === 404
}

/**
 * True when a physical attempt may have been billed but left no authoritative usage. Unbilled
 * rejections (missing previous response, flex capacity) and terminal responses that carry usage do
 * not need the latch. A caller cancel after dispatch may still have been billed, so it only skips
 * the latch when the caller states the cancel happened before the request was sent.
 */
export function shouldLatchUnknownBilledOpenAIAttempt(
  error: unknown,
  options: { cancelledBeforeDispatch?: boolean } = {},
): boolean {
  if (isOpenAIMissingPreviousResponseError(error)) return false
  if (isOpenAIFlexCapacityFailedResponseError(error)) return false
  if (options.cancelledBeforeDispatch && isExplicitClientCancelError(error)) return false
  if (error instanceof OpenAIResponseNotCompletedError) return error.usage == null
  return true
}

/** The provider's `Retry-After` in milliseconds, or `fallbackMs` (default 60s) when it sent none. */
export function getOpenAIRetryAfterMs(error: unknown, fallbackMs = 60_000): number {
  if (!(error instanceof APIError) || !error.headers) return fallbackMs
  return parseRetryAfter(readHeader(error.headers, 'retry-after')) ?? fallbackMs
}

function matchUpstreamFailure(current: object): OpenAIUpstreamFailure | null {
  if (current instanceof OpenAIResponseStreamIterationError) {
    // A stream that broke after emitting text may have been cut short by our own consumption.
    if (current.emittedTextDelta) return null
    return { reason: 'the response stream ended before emitting any text' }
  }
  if (current instanceof OpenAIResponseNotCompletedError) {
    if (current.code !== 'server_error') return null
    return { reason: 'OpenAI returned a failed response', code: current.code }
  }
  // Checked before APIError because it extends it and carries no status to match on.
  if (current instanceof APIConnectionError) return { reason: 'the connection to OpenAI failed' }
  if (!(current instanceof APIError) || current.status == null) return null
  const requestId = current.requestID ?? undefined
  if (current.status >= 500 || TRANSIENT_STATUSES.has(current.status)) {
    const code = current.code ?? undefined
    return { reason: `OpenAI returned ${current.status}`, status: current.status, requestId, code }
  }
  // A bodiless 404 came from an edge or gateway; every genuine 404 carries a JSON body with `code`.
  if (current.status === 404 && current.error === undefined && current.code === undefined) {
    return { reason: 'OpenAI returned a 404 with no error body', status: 404, requestId }
  }
  return null
}

/**
 * Describes an error that is the provider being unavailable rather than our code being wrong, or
 * null when the error is ours to own. Narrow on purpose: a retired model, a rejected key, a
 * changed response shape, or the caller's own timeout is never tolerated.
 */
export function describeOpenAIUpstreamFailure(error: unknown): OpenAIUpstreamFailure | null {
  if (isExplicitClientCancelError(error)) return null
  return findInErrorChain(error, matchUpstreamFailure)
}
