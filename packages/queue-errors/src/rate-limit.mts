import { Worker, type Job } from 'glide-mq'
import type { RateLimitErrorConstructor } from './index.mts'

/**
 * Floor for a deferral. GlideMQ replaces a falsy `delayMs` with the worker limiter's duration (or
 * one second), so a provider's `Retry-After: 0` could otherwise requeue the job at that unrelated
 * pace. One second also keeps a provider that always answers `0` from becoming a hot loop.
 */
export const MIN_RATE_LIMIT_DELAY_MS = 1_000
/** Used when the provider is rate limited but states no wait. */
export const DEFAULT_RATE_LIMIT_DELAY_MS = 60_000
/** Ceiling for a deferral, so a long provider wait is polled again instead of parking the job. */
export const MAX_RATE_LIMIT_DELAY_MS = 15 * 60_000
/** Longest a job may keep being requeued without spending an attempt, counted from creation. */
export const MAX_RATE_LIMIT_DEFERRAL_AGE_MS = 24 * 60 * 60_000

export interface RateLimitDelayOptions {
  minMs?: number
  defaultMs?: number
  maxMs?: number
  /** Overrides the signal class when the application resolves a different glide-mq copy. */
  RateLimitError?: RateLimitErrorConstructor
}

export interface DeferralBoundOptions {
  maxAgeMs?: number
  RateLimitError?: RateLimitErrorConstructor
}

type DeferrableJob = Pick<Job, 'moveToDelayed'>

/** Clamps a provider's `Retry-After` into the supported window; `null`/missing uses the default. */
export function clampRateLimitDelayMs(
  retryAfterMs?: number | null,
  options: RateLimitDelayOptions = {},
): number {
  const { minMs = MIN_RATE_LIMIT_DELAY_MS, defaultMs = DEFAULT_RATE_LIMIT_DELAY_MS } = options
  const { maxMs = MAX_RATE_LIMIT_DELAY_MS } = options
  if (retryAfterMs === undefined || retryAfterMs === null || !Number.isFinite(retryAfterMs)) {
    return defaultMs
  }
  return Math.min(maxMs, Math.max(minMs, Math.ceil(retryAfterMs)))
}

/**
 * Builds GlideMQ's rate-limit control-flow signal. The worker requeues the job after `delayMs`
 * without consuming an attempt, and the wait travels with the job rather than one process's memory.
 * A worker with a `limiter` also idles itself for `delayMs`; use `deferJobForRateLimit` on queues
 * that mix provider-bound and provider-free jobs.
 */
export function createRateLimitError(
  retryAfterMs?: number | null,
  cause?: unknown,
  options: RateLimitDelayOptions = {},
): Error & { delayMs: number } {
  const RateLimitError = options.RateLimitError ?? Worker.RateLimitError
  const error = Object.assign(new RateLimitError(), {
    delayMs: clampRateLimitDelayMs(retryAfterMs, options),
  })
  if (cause !== undefined) error.cause = cause
  return error
}

/** Throws the rate-limit signal; see `createRateLimitError`. */
export function throwRateLimited(
  retryAfterMs?: number | null,
  cause?: unknown,
  options: RateLimitDelayOptions = {},
): never {
  // oxlint-disable-next-line typescript/only-throw-error -- GlideMQ requires this control-flow signal to defer the job.
  throw createRateLimitError(retryAfterMs, cause, options)
}

/**
 * Parks only this job for the provider's wait, without consuming an attempt and without idling the
 * worker. `moveToDelayed` always rejects with GlideMQ's `DelayedError`, which the worker turns into
 * the delayed requeue.
 */
export function deferJobForRateLimit(
  job: DeferrableJob,
  retryAfterMs?: number | null,
  options: RateLimitDelayOptions = {},
): Promise<never> {
  return job.moveToDelayed(Date.now() + clampRateLimitDelayMs(retryAfterMs, options))
}

/**
 * Runs a processor and, once the job is older than `maxAgeMs`, turns a no-attempt requeue signal
 * into its plain `cause` so GlideMQ retries it under the job's attempts. Wrap queues whose jobs
 * call hosts the operator does not control, since such a host can name a wait on every answer.
 */
export async function boundRateLimitDeferral<T>(
  job: Pick<Job, 'timestamp'>,
  run: () => Promise<T>,
  options: DeferralBoundOptions = {},
): Promise<T> {
  try {
    return await run()
  } catch (err) {
    const { maxAgeMs = MAX_RATE_LIMIT_DEFERRAL_AGE_MS } = options
    const RateLimitError = options.RateLimitError ?? Worker.RateLimitError
    // GlideMQ writes `timestamp` once, when the job is added. A missing one reads as 0, which is
    // an unknown age and not an old job.
    const expired = job.timestamp > 0 && Date.now() - job.timestamp >= maxAgeMs
    if (!(err instanceof RateLimitError) || !expired) throw err
    throw err.cause instanceof Error
      ? err.cause
      : new Error('Rate limit deferral age exceeded', { cause: err })
  }
}
