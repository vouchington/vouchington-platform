import type { TestJobRecord } from 'glide-mq/testing'

import { captureFlushDiagnostics, TestQueueFlushTimeoutError } from './flush-diagnostics.mts'
import { DEFAULT_FLUSH_TIMEOUT_MS } from './flush-wait.mts'
import type { ShimTestQueue } from './queue.mts'

const RUNNABLE_STATES = new Set<TestJobRecord['state']>(['active', 'waiting', 'prioritized'])

/**
 * Wait for all runnable work on a test queue before measuring process resources. Delayed and
 * suspended records and parents waiting for children are parked. Active processors remain in scope
 * even after their records or workers disappear; waiting records need an attached worker to make
 * progress.
 */
export async function settleRunnableQueueJobs(
  queue: ShimTestQueue,
  flushTimeoutMs = DEFAULT_FLUSH_TIMEOUT_MS,
): Promise<void> {
  if (queue.workers.size === 0 && queue.activeWorkers.size === 0) return

  const deadline = AbortSignal.timeout(flushTimeoutMs)
  let pendingJobIds: string[] = []
  let transition = Promise.withResolvers<void>()
  let notified = false
  const expiration = Promise.withResolvers<never>()
  function notify(): void {
    notified = true
    transition.resolve()
  }
  function timedOut(): void {
    expiration.reject(
      new TestQueueFlushTimeoutError(
        queue.name,
        pendingJobIds,
        pendingJobIds,
        flushTimeoutMs,
        captureFlushDiagnostics(queue, pendingJobIds),
      ),
    )
    notify()
  }
  async function inspect(): Promise<void> {
    while (!deadline.aborted) {
      transition = Promise.withResolvers<void>()
      notified = false
      pendingJobIds = listRunnableJobIds(queue)
      if (notified) continue
      if (pendingJobIds.length === 0) return
      await transition.promise
    }
  }
  queue.settleWaiters.add(notify)
  deadline.addEventListener('abort', timedOut, { once: true })
  try {
    if (deadline.aborted) timedOut()
    await Promise.race([expiration.promise, inspect()])
  } finally {
    queue.settleWaiters.delete(notify)
    deadline.removeEventListener('abort', timedOut)
  }
}

function listRunnableJobIds(queue: ShimTestQueue): string[] {
  const pending: string[] = []
  for (const id of queue.unsettledJobIds) {
    const record = queue.jobs.get(id)
    if (
      record &&
      RUNNABLE_STATES.has(record.state) &&
      (queue.workers.size > 0 || record.state === 'active')
    ) {
      pending.push(id)
    }
  }
  for (const worker of queue.activeWorkers) {
    if (worker.getActiveCount() > 0) pending.push(`active-processor:${worker.id}`)
  }
  return pending
}
