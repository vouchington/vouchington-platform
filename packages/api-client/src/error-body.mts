export const DEFAULT_MAX_ERROR_RESPONSE_BYTES = 64 * 1024

export type ParseErrorBodyOptions = {
  /** Maximum bytes read from the body before it is discarded. Defaults to 64 KiB. */
  maxBytes?: number
  /** Receives non-fatal cancellation failures. Applications inject their error reporter. */
  onError?: (error: unknown) => void
}

/**
 * Reads a non-OK fetch response body and returns the parsed JSON when possible, the raw text
 * otherwise, or `null` when the body is oversized or unreadable.
 */
export async function parseErrorResponseBody(
  response: Response,
  options: ParseErrorBodyOptions = {},
): Promise<unknown> {
  const text = await readBoundedErrorText(response, options)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function readBoundedErrorText(
  response: Response,
  { maxBytes = DEFAULT_MAX_ERROR_RESPONSE_BYTES, onError = noop }: ParseErrorBodyOptions,
): Promise<string | null> {
  const contentLength = Number(response.headers.get('content-length'))
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    await response.body?.cancel().catch(onError)
    return null
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let bytes = 0
  let text = ''
  try {
    while (true) {
      // oxlint-disable-next-line no-await-in-loop -- one bounded response reader preserves backpressure.
      const result = await reader.read()
      if (result.done) return text + decoder.decode()
      bytes += result.value.byteLength
      if (bytes > maxBytes) {
        // oxlint-disable-next-line no-await-in-loop -- finish cancelling before releasing the oversized response.
        await reader.cancel().catch(onError)
        return null
      }
      text += decoder.decode(result.value, { stream: true })
    }
  } catch {
    return null
  } finally {
    reader.releaseLock()
  }
}

function noop(): void {}
