import type { TestJob, TestJobRecord, TestQueue } from 'glide-mq/testing'
import { captureFlushDiagnostics, TestQueueFlushTimeoutError } from './flush-diagnostics.mts'

export type FlushQueue<D = any, R = any> = TestQueue<D, R> & {
  settleWaiters: Set<() => void>
  enqueue: TestQueue<D, R>['add']
}

export const DEFAULT_FLUSH_TIMEOUT_MS = 4_000

type DeadLetterEnvelope = { originalJobId?: string }

/**
 * Ids still owed work. `waiting`, `prioritized` and `active` jobs will be processed, so a flush
 * waits for them. `delayed` (a `delay` option or `moveToDelayed`) and `suspended` jobs are parked
 * until a timer, `promote()` or a signal releases them, so a flush does not wait for those. A retried
 * job never stays `delayed`: the shim promotes it as soon as the worker parks it for its backoff.
 */
async function inspectJobs(
  queue: FlushQueue,
  jobs: TestJob[],
  expectedDeadLetterJobIds: Set<string>,
): Promise<string[]> {
  // Read admission before scanning mutable records, so a failure during this await is visible.
  const admitted = new Set(
    expectedDeadLetterJobIds.size === 0
      ? []
      : (await queue.getDeadLetterJobs()).map(
          (job) => (job.data as DeadLetterEnvelope | undefined)?.originalJobId,
        ),
  )
  const pending: string[] = []
  for (const job of jobs) {
    // The bound record retains terminal failure even after removeOnFail removes it from jobs.
    // oxlint-disable-next-line no-underscore-dangle -- glide-mq exposes no public identity for a test job
    const record = (job as unknown as { _record: TestJobRecord })._record
    if (record.state === 'failed') {
      if (!expectedDeadLetterJobIds.has(job.id)) {
        throw new Error(
          `Test queue job failed in "${queue.name}" (${record.name}#${job.id}): ${record.failedReason ?? 'unknown error'}`,
        )
      }
      if (!admitted.has(job.id)) pending.push(job.id)
    } else if (
      queue.jobs.get(job.id) === record &&
      ['waiting', 'prioritized', 'active', 'waiting-children'].includes(record.state)
    ) {
      pending.push(job.id)
    }
  }
  return pending
}

/**
 * Wait for `jobIds` to reach a terminal state (or land on the configured dead-letter queue for the
 * ids in `expectedDeadLetterJobIds`), bounded by `flushTimeoutMs`. No-ops immediately if the queue
 * has no attached workers: a queue nothing consumes cannot make progress, so waiting would only
 * burn the timeout (it becomes a bug only when nothing ever attaches a worker). Rejects with the
 * job's failure and, on timeout, with worker/queue diagnostics.
 *
 * Native `waitForJobs` waits through delayed and suspended states and rejects expected DLQ
 * failures. This flush deliberately settles parked jobs, accepts an expected DLQ failure only
 * after admission, and reads retained failure from each job's bound record. `Worker.drain()` closes
 * the worker, which tests keep attached.
 */
export async function flushJobs(
  queue: FlushQueue,
  jobs: TestJob[],
  expectedDeadLetterJobIds: Set<string>,
  flushTimeoutMs = DEFAULT_FLUSH_TIMEOUT_MS,
): Promise<void> {
  const deadline = AbortSignal.timeout(flushTimeoutMs)
  if ((await queue.getWorkers()).length === 0) return
  const jobIds = jobs.map((job) => job.id)

  let pendingJobIds = [...jobIds]
  let transition = Promise.withResolvers<void>()
  let notified = false
  const expiration = Promise.withResolvers<never>()
  function notify() {
    notified = true
    transition.resolve()
  }
  function timedOut() {
    expiration.reject(
      new TestQueueFlushTimeoutError(
        queue.name,
        [...jobIds],
        pendingJobIds,
        flushTimeoutMs,
        captureFlushDiagnostics(queue, pendingJobIds),
      ),
    )
    notify()
  }
  async function inspect() {
    while (!deadline.aborted) {
      transition = Promise.withResolvers<void>()
      notified = false
      const pending = await inspectJobs(queue, jobs, expectedDeadLetterJobIds)
      // A transition during an awaited read requires a fresh inspection before success.
      if (notified) continue
      pendingJobIds = pending
      if (pending.length === 0) return
      await transition.promise
    }
  }
  queue.settleWaiters.add(notify)
  deadline.addEventListener('abort', timedOut, { once: true })
  try {
    if (deadline.aborted) timedOut()
    // The deadline also bounds an inspection whose native getter never returns.
    await Promise.race([expiration.promise, inspect()])
  } finally {
    queue.settleWaiters.delete(notify)
    deadline.removeEventListener('abort', timedOut)
  }
}
