import {
  computeExponentialBackoffMs,
  getHeaderValue,
  isRetryableNetworkError,
  parseRetryAfter,
} from '@jongleberry/api-server/http-retry'

import { WikimediaDecodeError, WikimediaHttpError } from './errors.mts'
import type { WikimediaFetch } from './types.mts'

export class InternalTimeoutError extends Error {
  constructor() {
    super('The Wikimedia request timed out.')
  }
}

export class RetryableResponseError extends Error {
  constructor(
    readonly delay: number,
    readonly status: number | undefined,
    readonly url: string,
    readonly originalError?: unknown,
  ) {
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
): Promise<T> {
  if (callerSignal?.aborted) return Promise.reject(abortError(callerSignal.reason))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = <TValue,>(complete: (value: TValue) => void, value: TValue): void => {
      if (settled) return
      settled = true
      callerSignal?.removeEventListener('abort', rejectCaller)
      timeoutSignal.removeEventListener('abort', rejectTimeout)
      complete(value)
    }
    const rejectCaller = (): void => finish(reject, abortError(callerSignal?.reason))
    const rejectTimeout = (): void => finish(reject, new InternalTimeoutError())
    callerSignal?.addEventListener('abort', rejectCaller, { once: true })
    timeoutSignal.addEventListener('abort', rejectTimeout, { once: true })
    void Promise.resolve()
      .then(operation)
      .then(
        (value) => finish(resolve, value),
        (error: unknown) => finish(reject, error),
      )
  })
}

function boundedCleanup(response: Response, signal: AbortSignal): Promise<void> {
  const cleanup = Promise.resolve()
    .then(() => response.body?.cancel())
    .catch(() => undefined)
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const abort = (): void => done()
    function done(): void {
      signal.removeEventListener('abort', abort)
      resolve()
    }
    signal.addEventListener('abort', abort, { once: true })
    void cleanup.then(done)
  })
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

export function networkRetryDelay(attempt: number, maximum: number): number {
  return retryDelay(undefined, attempt, maximum)
}

function retryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

export function createAttempt(options: {
  fetch: WikimediaFetch
  timeoutMs: number
  maxRetryDelayMs: number
  userAgent: string
  url: string
  callerSignal: AbortSignal | undefined
  missingIsNull: boolean
  attempt: number
}): { result: Promise<unknown>; release: Promise<void> } {
  const timeout = new AbortController()
  const timer = setTimeout(() => timeout.abort(), options.timeoutMs)
  const signal = options.callerSignal
    ? AbortSignal.any([options.callerSignal, timeout.signal])
    : timeout.signal
  const fetch = Promise.resolve().then(() =>
    options.fetch(options.url, {
      signal,
      redirect: 'manual',
      headers: { 'user-agent': options.userAgent },
    }),
  )
  let response: Response | undefined
  let resultDone = false
  let resolveRelease!: () => void
  let cleanup: Promise<void> | undefined
  const release = new Promise<void>((resolve) => {
    resolveRelease = resolve
  })
  const finish = (lateResponse: Response | undefined): void => {
    if (lateResponse === undefined) {
      clearTimeout(timer)
      return resolveRelease()
    }
    cleanup ??= boundedCleanup(lateResponse, signal)
    void cleanup.then(() => {
      clearTimeout(timer)
      resolveRelease()
    })
  }
  void fetch.then(
    (lateResponse) => {
      if (resultDone) finish(lateResponse)
    },
    () => {
      if (resultDone) finish(undefined)
    },
  )
  const result = (async (): Promise<unknown> => {
    try {
      response = await raceWithAbort(() => fetch, options.callerSignal, timeout.signal)
      const received = response
      if (received.status === 404 && options.missingIsNull) return null
      if (received.status < 200 || received.status >= 300) {
        if (retryableStatus(received.status)) {
          throw new RetryableResponseError(
            retryDelay(received, options.attempt, options.maxRetryDelayMs),
            received.status,
            options.url,
          )
        }
        throw new WikimediaHttpError(received.status, options.url)
      }
      try {
        return await raceWithAbort(() => received.json(), options.callerSignal, timeout.signal)
      } catch (error) {
        if (error instanceof InternalTimeoutError || options.callerSignal?.aborted) throw error
        if (isRetryableNetworkError(error)) {
          throw new RetryableResponseError(
            retryDelay(undefined, options.attempt, options.maxRetryDelayMs),
            undefined,
            options.url,
            error,
          )
        }
        throw new WikimediaDecodeError(options.url)
      }
    } finally {
      resultDone = true
      if (response) finish(response)
      else void fetch.then(finish, () => finish(undefined))
    }
  })()
  return { result, release }
}
