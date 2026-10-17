import type { TestQueue } from 'glide-mq/testing'

export type TestQueueWorkerDiagnostic = {
  activeCount: number
  concurrency: number
}

export type TestQueuePendingJobDiagnostic = {
  jobId: string
  state: string | undefined
  inWaitingQueue: boolean
}

export type TestQueueFlushDiagnostics = {
  isPaused: boolean
  waitingQueueLength: number
  workers: TestQueueWorkerDiagnostic[]
  pendingJobs: TestQueuePendingJobDiagnostic[]
  /** Set when introspection itself threw; the other fields above are then just empty defaults. */
  captureError?: string
}

/**
 * Snapshot worker/queue state for a timed-out flush so the resulting error can tell "never
 * dispatched" (state 'waiting', still in `waitingQueue`, `activeCount === concurrency` on every
 * worker) apart from "dispatched but slow" (state 'active'). A timeout error that reported
 * only job IDs could not say whether the pending job was ever picked up.
 *
 * Worker counts and concurrency use TestWorker's public API. The synchronous timeout snapshot
 * reads the `@internal` `queue.workers` set to reach those workers without an asynchronous lookup.
 *
 * `queue.jobs` and `queue.waitingQueue` are `@internal` but public fields; a `prioritized` job
 * also sits in `waitingQueue` until a worker's promotion pass moves it to `waiting`. If any read
 * here throws, this degrades to a partial snapshot carrying `captureError` instead of throwing —
 * a broken diagnostic must never replace the timeout error it was meant to enrich.
 */
export function captureFlushDiagnostics(
  queue: TestQueue,
  pendingJobIds: readonly string[],
): TestQueueFlushDiagnostics {
  try {
    const workers: TestQueueWorkerDiagnostic[] = [...queue.workers].map((worker) => ({
      activeCount: worker.getActiveCount(),
      concurrency: worker.concurrency,
    }))
    const pendingJobs: TestQueuePendingJobDiagnostic[] = pendingJobIds.map((jobId) => {
      const record = queue.jobs.get(jobId)
      return {
        jobId,
        state: record?.state,
        inWaitingQueue: record !== undefined && queue.waitingQueue.includes(record),
      }
    })
    return {
      isPaused: queue.isPaused(),
      waitingQueueLength: queue.waitingQueue.length,
      workers,
      pendingJobs,
    }
  } catch (err) {
    return {
      isPaused: false,
      waitingQueueLength: -1,
      workers: [],
      pendingJobs: pendingJobIds.map((jobId) => ({
        jobId,
        state: undefined,
        inWaitingQueue: false,
      })),
      captureError: err instanceof Error ? err.message : String(err),
    }
  }
}

export class TestQueueFlushTimeoutError extends Error {
  readonly queueName: string
  readonly jobIds: readonly string[]
  readonly pendingJobIds: readonly string[]
  readonly flushTimeoutMs: number
  readonly diagnostics: TestQueueFlushDiagnostics
  constructor(
    queueName: string,
    jobIds: readonly string[],
    pendingJobIds: readonly string[],
    flushTimeoutMs: number,
    diagnostics: TestQueueFlushDiagnostics,
  ) {
    const detail = diagnostics.captureError
      ? `[diagnostics capture failed: ${diagnostics.captureError}]`
      : (() => {
          const workerSummary = diagnostics.workers
            .map((w) => `${w.activeCount}/${w.concurrency}`)
            .join(', ')
          const pendingSummary = diagnostics.pendingJobs
            .map((p) => `${p.jobId}:${p.state ?? 'missing'}${p.inWaitingQueue ? ' (queued)' : ''}`)
            .join(', ')
          return (
            `[workers active/concurrency: ${workerSummary || 'none'}; ` +
            `waitingQueue: ${diagnostics.waitingQueueLength}; paused: ${diagnostics.isPaused}; ` +
            `pending: ${pendingSummary || 'none'}]`
          )
        })()
    super(`Timed out waiting for test queue jobs in "${queueName}" ${detail}`)
    this.name = 'TestQueueFlushTimeoutError'
    this.queueName = queueName
    this.jobIds = jobIds
    this.pendingJobIds = pendingJobIds
    this.flushTimeoutMs = flushTimeoutMs
    this.diagnostics = diagnostics
  }
}
