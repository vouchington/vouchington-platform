import type { Job } from 'glide-mq'
import {
  boundRateLimitDeferral,
  throwRateLimited,
  type DeferralBoundOptions,
} from './rate-limit.mts'

// pg-pool emits these when a new connection cannot be established or a queued
// checkout cannot acquire a client before connectionTimeoutMillis expires.
export const POSTGRES_CONNECTION_TIMEOUT_MESSAGES: readonly string[] = [
  'Connection terminated due to connection timeout',
  'timeout exceeded when trying to connect',
]
export const POSTGRES_CONNECTION_RETRY_DELAY_MS = 30_000

export interface PostgresConnectionTimeoutOptions extends DeferralBoundOptions {
  messages?: readonly string[]
  retryDelayMs?: number
}

/** Defers a worker job while its PostgreSQL pool cannot supply a connection. */
export async function deferPostgresConnectionTimeout<T>(
  job: Pick<Job, 'timestamp'>,
  run: () => Promise<T>,
  options: PostgresConnectionTimeoutOptions = {},
): Promise<T> {
  const { messages = POSTGRES_CONNECTION_TIMEOUT_MESSAGES } = options
  const { retryDelayMs = POSTGRES_CONNECTION_RETRY_DELAY_MS } = options
  try {
    return await run()
  } catch (err) {
    if (!(err instanceof Error) || !messages.includes(err.message)) throw err
    // A no-attempt requeue cannot continue forever during a persistent outage; once the deferral
    // age is exhausted, retry under the job's attempts.
    return boundRateLimitDeferral(
      job,
      async () => throwRateLimited(retryDelayMs, err, options),
      options,
    )
  }
}
