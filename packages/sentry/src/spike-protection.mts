import { createSpikeWindowTracker } from '@vouchington/utils/observability'

export interface SpikeProtectableEvent {
  exception?: { values?: Array<{ type?: string; value?: string }> }
  message?: string
  fingerprint?: string[]
}

export interface SpikeProtectionOptions {
  /** Identical errors allowed per window. Default 10. */
  limit?: number
  /** Window length in milliseconds. Default five minutes. */
  windowMs?: number
  now?: () => number
}

type Result<T> = T | null | PromiseLike<T | null>

function fingerprintOf(event: SpikeProtectableEvent): string | null {
  if (event.fingerprint && event.fingerprint.length > 0) return event.fingerprint.join('\u0000')
  const exception = event.exception?.values?.[0]
  if (exception?.type || exception?.value) {
    return `${exception.type ?? ''}\u0000${exception.value ?? ''}`
  }
  return event.message ? `message\u0000${event.message}` : null
}

function isPromiseLike<T>(value: unknown): value is PromiseLike<T> {
  return (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function') &&
    typeof (value as { then?: unknown }).then === 'function'
  )
}

/**
 * Wrap a `beforeSend` so one recurring error cannot consume the error quota: once an identical
 * error was sent `limit` times in `windowMs`, further copies are dropped until the window resets.
 * Events with no reliable identity are never suppressed.
 */
export function withSpikeProtection<T extends SpikeProtectableEvent, H>(
  beforeSend: (event: T, hint: H) => Result<T>,
  { limit = 10, windowMs = 5 * 60_000, now = Date.now }: SpikeProtectionOptions = {},
): (event: T, hint: H) => Result<T> {
  const tracker = createSpikeWindowTracker(limit, windowMs)
  const admit = (event: T): T | null => {
    const fingerprint = fingerprintOf(event)
    if (fingerprint === null) return event
    return tracker.recordAndCheck(fingerprint, now()) ? event : null
  }
  return (event, hint) => {
    const result = beforeSend(event, hint)
    if (isPromiseLike<T | null>(result)) {
      return result.then((next) => (next === null ? null : admit(next)))
    }
    return result === null ? null : admit(result)
  }
}
