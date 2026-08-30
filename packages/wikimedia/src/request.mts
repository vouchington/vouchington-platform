import { isRetryableNetworkError } from '@jongleberry/api-server/http-retry'

import {
  createAttempt,
  InternalTimeoutError,
  networkRetryDelay,
  RetryableResponseError,
} from './attempt.mts'
import { WikimediaHttpError } from './errors.mts'
import { createRequestQueue } from './request-queue.mts'
import type { WikimediaFetch } from './types.mts'

const attempts = 3

function abortError(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new DOMException('The operation was aborted.', 'AbortError')
}

function abortableDelay(milliseconds: number, signal: AbortSignal | undefined): Promise<void> {
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
  const request = async (
    url: string,
    callerSignal: AbortSignal | undefined,
    missingIsNull = false,
  ): Promise<unknown> => {
    let attempt = 1
    while (true) {
      try {
        return await queue.run(callerSignal, () =>
          createAttempt({ ...options, url, callerSignal, missingIsNull, attempt }),
        )
      } catch (error) {
        if (callerSignal?.aborted) throw abortError(callerSignal.reason)
        const retryable =
          error instanceof InternalTimeoutError ||
          error instanceof RetryableResponseError ||
          isRetryableNetworkError(error)
        if (!retryable || attempt === attempts) {
          if (error instanceof RetryableResponseError && error.status !== undefined) {
            throw new WikimediaHttpError(error.status, error.url)
          }
          if (error instanceof RetryableResponseError && error.originalError !== undefined) {
            throw error.originalError
          }
          throw error
        }
        await abortableDelay(
          error instanceof RetryableResponseError
            ? error.delay
            : networkRetryDelay(attempt, options.maxRetryDelayMs),
          callerSignal,
        )
        attempt += 1
      }
    }
  }
  return { getJson: request }
}
