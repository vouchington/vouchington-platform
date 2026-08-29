function abortError(reason: unknown): Error {
  return reason instanceof Error
    ? reason
    : new DOMException('The operation was aborted.', 'AbortError')
}

interface WaitingRequest<T> {
  operation: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
  signal: AbortSignal | undefined
  removeAbortListener: () => void
}

export function createRequestQueue(maximum: number): {
  run<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T>
} {
  let active = 0
  let waiting: WaitingRequest<unknown>[] = []

  const drain = (): void => {
    while (active < maximum && waiting.length > 0) {
      const request = waiting.shift()!
      request.removeAbortListener()
      active += 1
      void request
        .operation()
        .then(
          (value) => request.resolve(value),
          (error: unknown) => request.reject(error),
        )
        .finally(() => {
          active -= 1
          drain()
        })
    }
  }

  return {
    run<T>(signal: AbortSignal | undefined, operation: () => Promise<T>): Promise<T> {
      if (signal?.aborted) return Promise.reject(abortError(signal.reason))
      return new Promise<T>((resolve, reject) => {
        const request: WaitingRequest<T> = {
          operation,
          reject,
          resolve,
          signal,
          removeAbortListener: () => undefined,
        }
        const rejectIfAborted = (): void => {
          waiting = waiting.filter((pending) => pending !== request)
          reject(abortError(signal?.reason))
        }
        if (signal) {
          signal.addEventListener('abort', rejectIfAborted, { once: true })
          request.removeAbortListener = () => signal.removeEventListener('abort', rejectIfAborted)
        }
        waiting.push(request as WaitingRequest<unknown>)
        drain()
      })
    },
  }
}
