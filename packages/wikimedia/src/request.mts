import {
  computeExponentialBackoffMs,
  getHeaderValue,
  isRetryableNetworkError,
  parseRetryAfter,
} from '@jongleberry/api-server/http-retry'

import { WikimediaDecodeError, WikimediaHttpError } from './errors.mts'
import { createRequestQueue } from './request-queue.mts'
import type { WikimediaFetch } from './types.mts'

const attempts = 3

class InternalTimeoutError extends Error {
  constructor() {
    super('The Wikimedia request timed out.')
  }
}

class RetryableResponseError extends Error {
  constructor(readonly delay: number) {
    super('The Wikimedia response is retryable.')
  }
}

function abortError(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new DOMException('The operation was aborted.', 'AbortError')
}

function raceWithAbort<T>(
  operation: () => Promise<T>,
  callerSignal: AbortSignal | undefined,
  timeoutSignal: AbortSignal,
  disposeLateValue?: (value: T) => Promise<void>,
): Promise<T> {
  if (callerSignal?.aborted) return Promise.reject(abortError(callerSignal.reason))
  if (timeoutSignal.aborted) return Promise.reject(new InternalTimeoutError())
  return new Promise((resolve, reject) => {
    let settled = false
    const cleanup = (): void => {
      callerSignal?.removeEventListener('abort', rejectCaller)
      timeoutSignal.removeEventListener('abort', rejectTimeout)
    }
    const finish = <TValue,>(complete: (value: TValue) => void, value: TValue): void => {
      if (settled) return
      settled = true
      cleanup()
      complete(value)
    }
    const rejectCaller = (): void => finish(reject, abortError(callerSignal?.reason))
    const rejectTimeout = (): void => finish(reject, new InternalTimeoutError())
    callerSignal?.addEventListener('abort', rejectCaller, { once: true })
    timeoutSignal.addEventListener('abort', rejectTimeout, { once: true })
    let pending: Promise<T>
    try {
      pending = operation()
    } catch (error) {
      finish(reject, error)
      return
    }
    void pending.then(
      (value) => {
        if (settled) {
          if (disposeLateValue) void disposeLateValue(value)
          return
        }
        finish(resolve, value)
      },
      (error: unknown) => finish(reject, error),
    )
  })
}

function abortableDelay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError(signal.reason))
  if (milliseconds === 0) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const timer = setTimeout(done, milliseconds)
    const abort = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', abort)
      reject(abortError(signal?.reason))
    }
    function done(): void {
      signal?.removeEventListener('abort', abort)
      resolve()
    }
    signal?.addEventListener('abort', abort, { once: true })
  })
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel()
  } catch {
    // Cleanup must never mask the original request result.
  }
}

function retryDelay(response: Response | undefined, attempt: number, maximum: number): number {
  const retryAfter = response && parseRetryAfter(getHeaderValue(response.headers, 'retry-after'))
  if (retryAfter !== null && retryAfter !== undefined) return Math.min(retryAfter, maximum)
  if (maximum === 0) return 0
  return computeExponentialBackoffMs({
    attempt: attempt - 1,
    baseDelayMs: 250,
    maxDelayMs: maximum,
    random: 1,
  })
}

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

export interface WikimediaRequester {
  getJson(url: string, signal: AbortSignal | undefined, missingIsNull?: boolean): Promise<unknown>
}

export function createWikimediaRequester(options: {
  fetch: WikimediaFetch
  timeoutMs: number
  maxRetryDelayMs: number
  userAgent: string
}): WikimediaRequester {
  const queue = createRequestQueue(3)
  const requestAttempt = async (
    url: string,
    callerSignal: AbortSignal | undefined,
    missingIsNull: boolean,
    attempt: number,
  ): Promise<unknown> => {
    const timeout = new AbortController()
    const timer = setTimeout(() => timeout.abort(), options.timeoutMs)
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout.signal]) : timeout.signal
    let response: Response | undefined
    try {
      response = await raceWithAbort(
        () =>
          options.fetch(url, {
            signal,
            redirect: 'manual',
            headers: { 'user-agent': options.userAgent },
          }),
        callerSignal,
        timeout.signal,
        cancelBody,
      )
      const received = response
      if (received.status === 404 && missingIsNull) return null
      if (received.status < 200 || received.status >= 300) {
        if (isRetryableStatus(received.status)) {
          throw new RetryableResponseError(retryDelay(received, attempt, options.maxRetryDelayMs))
        }
        throw new WikimediaHttpError(received.status, url)
      }
      try {
        return await raceWithAbort(() => received.json(), callerSignal, timeout.signal)
      } catch (error) {
        if (error instanceof InternalTimeoutError || callerSignal?.aborted) throw error
        if (isRetryableNetworkError(error)) {
          throw new RetryableResponseError(retryDelay(undefined, attempt, options.maxRetryDelayMs))
        }
        throw new WikimediaDecodeError(url)
      }
    } finally {
      clearTimeout(timer)
      if (response) await cancelBody(response)
    }
  }
  const request = async (
    url: string,
    callerSignal: AbortSignal | undefined,
    missingIsNull = false,
  ): Promise<unknown> => {
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await queue.run(callerSignal, () =>
          requestAttempt(url, callerSignal, missingIsNull, attempt),
        )
      } catch (error) {
        if (callerSignal?.aborted) throw abortError(callerSignal.reason)
        const retryable =
          error instanceof InternalTimeoutError ||
          error instanceof RetryableResponseError ||
          isRetryableNetworkError(error)
        if (!retryable || attempt === attempts) throw error
        const delay =
          error instanceof RetryableResponseError
            ? error.delay
            : retryDelay(undefined, attempt, options.maxRetryDelayMs)
        await abortableDelay(delay, callerSignal)
      }
    }
    throw new WikimediaHttpError(599, url)
  }
  return { getJson: request }
}
