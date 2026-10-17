import type { CaptureClient } from './types.mts'

export interface CaptureOptions {
  /** Message used when a non-Error value is thrown. */
  fallbackMessage: string
  tags?: Record<string, string> | undefined
  extra?: Record<string, unknown> | undefined
  /** Product predicate for expected errors that must not be reported. */
  isExpected?: (error: unknown) => boolean
}

/**
 * Report an unknown thrown value. Non-Error values are wrapped and kept under
 * `extra.originalValue`. Returns whether the value was sent to the SDK.
 */
export function captureError(
  client: CaptureClient,
  error: unknown,
  options: CaptureOptions,
): boolean {
  if (options.isExpected?.(error)) return false
  const captured = error instanceof Error ? error : new Error(options.fallbackMessage)
  const extra = error instanceof Error ? options.extra : { ...options.extra, originalValue: error }
  client.captureException(captured, {
    ...(options.tags && { tags: options.tags }),
    ...(extra && Object.keys(extra).length > 0 && { extra }),
  })
  return true
}
