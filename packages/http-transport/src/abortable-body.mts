import type { Response as UndiciResponse } from 'undici'

export interface AbortableBodyOptions {
  /** Receives non-fatal cancellation errors; defaults to a no-op. */
  onError?: (error: unknown) => void
}

export type ResponseWithBody = (Pick<Response, 'body'> | Pick<UndiciResponse, 'body'>) & {
  readonly status?: number
  readonly statusText?: string
  readonly headers?: Response['headers'] | UndiciResponse['headers']
}

/**
 * Wraps a global or Undici response so its body stream cancels when `signal` aborts, while
 * preserving status, statusText, headers, and reader-lock cleanup. Native responses without a
 * signal are returned unchanged.
 */
export function withAbortableBody(
  response: ResponseWithBody,
  signal?: AbortSignal,
  options: AbortableBodyOptions = {},
): Response {
  if (response instanceof Response && !signal) return response
  const init: ResponseInit = {
    ...(response.status === undefined ? {} : { status: response.status }),
    ...(response.statusText === undefined ? {} : { statusText: response.statusText }),
    ...(response.headers === undefined
      ? {}
      : { headers: response.headers as NonNullable<ResponseInit['headers']> }),
  }
  if (!response.body) {
    return response instanceof Response ? response : new Response(null, init)
  }

  const onError = options.onError ?? noop
  const reader = response.body.getReader()
  let released = false
  let cancelPromise: Promise<void> | undefined
  let abortListener: (() => void) | undefined

  function release(): void {
    if (released) return
    released = true
    if (signal && abortListener) signal.removeEventListener('abort', abortListener)
    reader.releaseLock()
  }

  function cancel(reason: unknown): Promise<void> {
    if (released) return Promise.resolve()
    cancelPromise ??= reader.cancel(reason).catch(onError).finally(release)
    return cancelPromise
  }

  if (signal) {
    abortListener = () => {
      void cancel(signal.reason)
    }
    if (signal.aborted) abortListener()
    else signal.addEventListener('abort', abortListener, { once: true })
  }

  return new Response(
    new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (released || cancelPromise) {
          controller.close()
          return
        }
        try {
          const result = await reader.read()
          if (result.done) {
            release()
            controller.close()
          } else {
            const chunk: unknown = result.value
            if (!(chunk instanceof Uint8Array)) {
              throw new TypeError('Response body chunk is not bytes')
            }
            controller.enqueue(chunk)
          }
        } catch (err) {
          release()
          controller.error(err)
        }
      },
      async cancel(reason) {
        await cancel(reason)
      },
    }),
    init,
  )
}

function noop(): void {}
