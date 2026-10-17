import type { ErrorEvent, EventHint } from '@sentry/core'

export interface EventFilterOptions {
  /** Product predicate for errors that are expected and must not reach Sentry. */
  isExpected?: (error: unknown) => boolean
  /** Drop errors whose numeric `status`/`statusCode` is below this value. Default 500. */
  minimumStatus?: number
  /** Error `code` values dropped as connection noise. Default ECONNRESET and EPIPE. */
  ignoredCodes?: readonly string[]
  /** Exact error messages dropped as noise. Default `Premature close`. */
  ignoredMessages?: readonly string[]
}

function readStatus(error: Record<string, unknown>): number | null {
  if (typeof error.status === 'number') return error.status
  return typeof error.statusCode === 'number' ? error.statusCode : null
}

/** Build a `beforeSend` that drops tagged, expected, client-error, and connection-noise events. */
export function createEventFilter(
  options: EventFilterOptions = {},
): (event: ErrorEvent, hint: EventHint) => ErrorEvent | null {
  const {
    isExpected,
    minimumStatus = 500,
    ignoredCodes = ['ECONNRESET', 'EPIPE'],
    ignoredMessages = ['Premature close'],
  } = options
  return (event, hint) => {
    if (event.tags?.suppressLogging === true) return null
    const original = hint.originalException
    if (isExpected?.(original)) return null
    if (original === null || typeof original !== 'object') return event
    const error = original as Record<string, unknown>
    if (typeof error.message === 'string' && ignoredMessages.includes(error.message)) return null
    const status = readStatus(error)
    if (status !== null && status < minimumStatus) return null
    if (typeof error.code === 'string' && ignoredCodes.includes(error.code)) return null
    return event
  }
}
