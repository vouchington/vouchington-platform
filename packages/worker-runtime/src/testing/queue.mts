import { type TestJob, TestQueue, type TestQueueOptions } from 'glide-mq/testing'

import { addAndFlush, addBulkAndFlush, type TestJobOptions } from './flush.mts'
import { runInsideTestWorkerProcessor } from './processor-context.mts'

const queues = new Map<string, ShimTestQueue>()

/**
 * In-memory queue whose `add`/`addBulk` wait for attached workers to settle the jobs. Instances are
 * shared by name for the lifetime of the module, so producers and workers meet on one store.
 */
export class ShimTestQueue<D = any, R = any> extends TestQueue<D, R> {
  /** Flush waiters, woken by actual job transitions. */
  readonly settleWaiters = new Set<() => void>()
  readonly #notifySettleWaiters = () => {
    for (const waiter of this.settleWaiters) waiter()
  }

  constructor(name: string, options?: TestQueueOptions) {
    const existing = queues.get(name)
    if (existing) {
      existing.#configureDeadLetterQueue(options)
      // oxlint-disable-next-line no-constructor-return -- every producer and native lookup must share one store
      return existing
    }
    super(name, options)
    queues.set(name, this)
    this.#configureDeadLetterQueue(options)
    this.on('retrying', (job: TestJob) => {
      // Native promote changes the record synchronously and emits the wake-up event.
      void job.promote().catch(() => undefined)
    })
    for (const event of [
      'failed',
      'completed',
      'delay-changed',
      'suspended',
      'promoted',
      'removed',
      'revoked',
      'drained',
    ]) {
      this.on(event, this.#notifySettleWaiters)
    }
  }
  #configureDeadLetterQueue(options?: TestQueueOptions) {
    if (!options?.deadLetterQueue) return
    this.deadLetterQueueName = options.deadLetterQueue.name
    // Native workers and flows must resolve the same store by name.
    getOrCreateQueue(options.deadLetterQueue.name)
  }

  /** Unflushed native admission for fixtures and the automatic-flush implementation. */
  enqueue(name: string, data: D, opts?: TestJobOptions) {
    return super.add(name, data, opts)
  }

  override add(name: string, data: D, opts?: TestJobOptions): Promise<TestJob<D, R> | null> {
    return addAndFlush(this, name, data, opts)
  }

  override addBulk(
    jobs: Array<{ name: string; data: D; opts?: TestJobOptions }>,
  ): Promise<TestJob<D, R>[]> {
    return addBulkAndFlush(this, jobs)
  }

  override addAndWait(...args: Parameters<TestQueue<D, R>['addAndWait']>) {
    return runInsideTestWorkerProcessor(() => super.addAndWait(...args))
  }

  override replayDeadLetterJob(jobId: string) {
    return runInsideTestWorkerProcessor(() => super.replayDeadLetterJob(jobId))
  }

  // Producer close leaves shared state and independently owned workers alive.
  override async close(): Promise<void> {}

  override async obliterate(
    _opts?: { force?: boolean },
    visited = new Set<string>(),
  ): Promise<void> {
    if (visited.has(this.name)) return
    visited.add(this.name)
    await super.obliterate({ force: true })
    await this.resume()
    this.#notifySettleWaiters()
    if (this.deadLetterQueueName) {
      await getOrCreateQueue(this.deadLetterQueueName).obliterate(undefined, visited)
    }
  }
}

export function getOrCreateQueue(name: string, options?: TestQueueOptions): ShimTestQueue {
  return new ShimTestQueue(name, options)
}

async function listAttachedWorkers(): Promise<Array<{ queueName: string; workerId: string }>> {
  const infos = [...queues].map(async ([queueName, queue]) =>
    (await queue.getWorkers()).map((worker) => ({ queueName, workerId: worker.id })),
  )
  return (await Promise.all(infos)).flat()
}

/** Snapshot the id of every TestWorker currently attached through the in-memory queue shim. */
export async function captureAttachedTestWorkers(): Promise<ReadonlySet<string>> {
  return new Set((await listAttachedWorkers()).map(({ workerId }) => workerId))
}

/**
 * Return queue names that acquired an attached TestWorker after the supplied baseline.
 * Queue names, rather than workers, make the guard's remediation actionable and deterministic.
 */
export async function getUnexpectedAttachedTestWorkerQueueNames(
  baseline: ReadonlySet<string>,
): Promise<string[]> {
  const attached = await listAttachedWorkers()
  const unexpected = attached.filter(({ workerId }) => !baseline.has(workerId))
  return [...new Set(unexpected.map(({ queueName }) => queueName))].toSorted()
}
