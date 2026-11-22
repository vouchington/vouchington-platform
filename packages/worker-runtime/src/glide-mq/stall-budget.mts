import { UnrecoverableError, type Job, type Processor } from 'glide-mq'

/** Two cumulative stalls survive a rolling deploy plus a delayed heartbeat without hiding loops. */
export const DEFAULT_MAX_STALLED_COUNT = 2

export interface StallBudgetOptions {
  /** Reads one hash field, for example `(key, field) => client.hget(key, field)`. */
  hget(key: string, field: string): Promise<unknown>
  /** Key prefix of the worker; default `glide`. */
  prefix?: string | undefined
  /** Stalls an ordinary job may accumulate before it fails; default 2. */
  maxStalledCount?: number
  /** Jobs that keep the worker's own, higher native stall limit and skip this check. */
  exempt?: (job: Job) => boolean
}

/**
 * A shared worker's high native `maxStalledCount` must not grant ordinary handlers extra
 * side-effect runs. Before the handler runs, a non-exempt job whose stored `stalledCount` exceeds
 * the budget fails with `UnrecoverableError`.
 */
export function withStallBudget<D, R>(
  queueName: string,
  processor: Processor<D, R>,
  options: StallBudgetOptions,
): Processor<D, R> {
  const budget = options.maxStalledCount ?? DEFAULT_MAX_STALLED_COUNT
  return async (job) => {
    if (!options.exempt?.(job)) {
      const stalls = await options.hget(
        `${options.prefix ?? 'glide'}:{${queueName}}:job:${job.id}`,
        'stalledCount',
      )
      if (Number(stalls) > budget)
        throw new UnrecoverableError('Job exceeded its stalled recovery budget')
    }
    return processor(job)
  }
}
