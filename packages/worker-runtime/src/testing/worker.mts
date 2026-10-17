import { TestWorker } from 'glide-mq/testing'

import { runInsideTestWorkerProcessor } from './processor-context.mts'
import { getOrCreateQueue, type ShimTestQueue } from './queue.mts'

export const MAX_TEST_WORKER_CONCURRENCY = 15

/** Clamp a requested worker concurrency to the in-memory test worker cap. */
export function clampTestWorkerConcurrency(concurrency?: number): number {
  return concurrency != null
    ? Math.min(concurrency, MAX_TEST_WORKER_CONCURRENCY)
    : MAX_TEST_WORKER_CONCURRENCY
}

export type TestWorkerProcessor<R = any> = (job: any) => Promise<R> | R

export type WorkerOptions<R = any> = {
  concurrency?: number
  limiter?: { max: number; duration: number }
  tokenLimiter?: { maxTokens: number; duration: number; scope?: string }
  deadLetterQueue?: { name: string }
  lockDuration?: number
  stalledInterval?: number
  batch?: { size: number; timeout?: number }
  /**
   * Application hook to decorate the processor (profiling, context propagation). It runs inside
   * the processor context, so nested adds do not auto-flush. Subclass Worker to supply it.
   */
  wrapProcessor?: (processor: TestWorkerProcessor<R>, queueName: string) => TestWorkerProcessor<R>
}

/**
 * Production-shaped Worker over the in-memory TestWorker. Production-only options are accepted and
 * dropped, concurrency is clamped, and batches dispatch immediately.
 */
export class Worker<D = any, R = any> extends TestWorker<D, R> {
  constructor(
    queueNameOrQueue: string | ShimTestQueue<D, R>,
    processor: TestWorkerProcessor<R> | ((jobs: any[]) => Promise<R[]>),
    options?: WorkerOptions<R>,
  ) {
    const queueName =
      typeof queueNameOrQueue === 'string' ? queueNameOrQueue : queueNameOrQueue.name
    const deadLetterQueue = options?.deadLetterQueue
    const queue = getOrCreateQueue(
      queueName,
      deadLetterQueue ? { deadLetterQueue } : undefined,
    ) as ShimTestQueue<D, R>
    // scope is production-only routing TestWorkerOptions.tokenLimiter doesn't accept; dropped
    const tokenLimiterOpts = options?.tokenLimiter
      ? { maxTokens: options.tokenLimiter.maxTokens, duration: options.tokenLimiter.duration }
      : undefined
    // `timeout: 0` dispatches whatever is waiting immediately instead of holding a partial batch
    // for the production flush window, which would add that window to every flushed add.
    const batch = options?.batch ? { size: options.batch.size, timeout: 0 } : undefined
    const base = processor as TestWorkerProcessor<R>
    const wrapped = options?.wrapProcessor?.(base, queueName) ?? base
    super(
      queue,
      ((job: unknown) => runInsideTestWorkerProcessor(() => Promise.resolve(wrapped(job)))) as any,
      {
        concurrency: clampTestWorkerConcurrency(options?.concurrency),
        ...(deadLetterQueue && { deadLetterQueue }),
        ...(options?.limiter && { limiter: options.limiter }),
        ...(batch && { batch }),
        ...(tokenLimiterOpts && { tokenLimiter: tokenLimiterOpts }),
      },
    )
  }
}
