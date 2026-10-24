/**
 * Rejects with the signal's reason when it aborts; the underlying promise keeps running.
 * An already-aborted signal rejects at once, and the abandoned promise gets a no-op handler so
 * a later failure is not an unhandled rejection.
 */
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise
  if (signal.aborted) {
    promise.catch(() => undefined)
    return Promise.reject(signal.reason as Error)
  }
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason as Error)
    signal.addEventListener('abort', onAbort, { once: true })
    promise.finally(() => signal.removeEventListener('abort', onAbort)).then(resolve, reject)
  })
}
