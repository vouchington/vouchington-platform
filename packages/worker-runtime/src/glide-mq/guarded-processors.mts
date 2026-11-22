import { AsyncLocalStorage } from 'node:async_hooks'
import {
  BatchError,
  DelayedError,
  type BatchProcessor,
  type Job,
  type JobOptions,
  type Processor,
  type WorkerOptions,
} from 'glide-mq'
import type { ScheduledRunLease } from './scheduled-run-lease.mts'

type ActiveJob = { queue: string; jobId: string; dedupId?: string | undefined }
type Release = () => Promise<void>
type LeaseOptions = Pick<WorkerOptions, 'lockDuration' | 'maxStalledCount' | 'prefix'>

export interface GuardedProcessorsConfig {
  /** Admits or skips scheduler ticks, normally from `createScheduledRunLease`. */
  lease: ScheduledRunLease
  /** Receives release and self-add reporting failures. */
  onError?: (error: Error) => void
  /** Throw on a self-add instead of reporting it; default true. Pass false in production. */
  throwOnSelfAdd?: boolean
  /** Default `console`. */
  logger?: Pick<Console, 'error'>
}

export interface GuardedProcessors {
  /** Wraps a single-job processor; the argument order matches the runtime's `wrapProcessor` hook. */
  wrapSingleProcessor<D, R>(
    processor: Processor<D, R>,
    queue: string,
    options: LeaseOptions,
  ): Processor<D, R>
  /** Wraps a batch processor; skipped scheduler ticks resolve `undefined` in the result array. */
  wrapBatchProcessor<D, R>(
    processor: BatchProcessor<D, R>,
    queue: string,
    options: LeaseOptions,
  ): BatchProcessor<D, R>
  /** True when this processor is already running `jobId` on `queue`. Re-adding that id is rejected. */
  isActiveProcessorJob(queue: string, jobId: string | undefined): boolean
  /**
   * Detects a processor adding the job it is running (same job id or deduplication id). Returns
   * true when the add must be dropped, and throws first when `throwOnSelfAdd` is set. Call it from
   * the runtime's `guardAdd` hook.
   */
  rejectSelfAdd(queue: string, jobName: string, opts?: JobOptions): boolean
}

/**
 * Wraps processors with the scheduled-run lease (released after success or failure) and tracks the
 * running jobs in `AsyncLocalStorage` so a processor cannot enqueue itself.
 */
export function createGuardedProcessors(config: GuardedProcessorsConfig): GuardedProcessors {
  const activeJobs = new AsyncLocalStorage<ActiveJob[]>()
  const logger = config.logger ?? console
  const report = (error: Error, fallback: string) => {
    try {
      config.onError?.(error)
    } catch (err) {
      // Diagnostics must not replace the original processor or lease error.
      logger.error(fallback, err)
    }
  }

  async function releaseAll(releases: Release[]): Promise<void> {
    const results = await Promise.allSettled(releases.map((release) => release()))
    for (const result of results) {
      if (result.status !== 'rejected') continue
      const reason: unknown = result.reason
      report(
        reason instanceof Error ? reason : new Error(String(reason), { cause: reason }),
        'scheduled_lease_release_reporting_failed',
      )
    }
  }

  const activeJob = (queue: string, job: Job): ActiveJob => ({
    queue,
    jobId: job.id,
    dedupId: job.opts.deduplication?.id,
  })

  return {
    wrapSingleProcessor(processor, queue, options) {
      return async (job) => {
        const release = await config.lease(queue, job, options)
        if (!release) return undefined as never
        try {
          const result = await activeJobs.run([activeJob(queue, job)], () => processor(job))
          await releaseAll([release])
          return result
        } catch (err) {
          await releaseAll([release])
          throw err
        }
      }
    },
    wrapBatchProcessor(processor, queue, options) {
      return async (jobs) => {
        const releases: Release[] = []
        const runnable: Job<any, any>[] = []
        const deferred = new Map<Job<any, any>, DelayedError>()
        let result: unknown[]
        let partial = false
        try {
          for (const job of jobs) {
            try {
              // oxlint-disable-next-line no-await-in-loop -- preserve batch order when two jobs share a scheduler lease
              const release = await config.lease(queue, job, options)
              if (release) {
                releases.push(release)
                runnable.push(job)
              }
            } catch (err) {
              // GlideMQ's batch path ignores moveToDelayed, so a deferral must not abort the batch.
              if (!(err instanceof DelayedError)) throw err
              deferred.set(job, err)
            }
          }
          let values: unknown[] = []
          if (runnable.length) {
            try {
              values = await activeJobs.run(
                runnable.map((job) => activeJob(queue, job)),
                () => processor(runnable),
              )
            } catch (err) {
              if (!(err instanceof BatchError)) throw err
              partial = true
              values = err.results
            }
          }
          // Results are positional against the original batch, not the runnable subset.
          result = jobs.map((job) => {
            const deferral = deferred.get(job)
            if (deferral) return deferral
            const index = runnable.indexOf(job)
            if (index < 0) return undefined
            return partial && index >= values.length
              ? new Error('No result in BatchError')
              : values[index]
          })
        } finally {
          await releaseAll(releases)
        }
        // A deferred job reports its DelayedError as a per-job failure, so the worker retries it
        // through its normal attempts and backoff instead of resolving it as a success.
        if (partial || deferred.size > 0) throw new BatchError(result)
        return result as never
      }
    },
    isActiveProcessorJob(queue, jobId) {
      if (!jobId) return false
      return (
        activeJobs.getStore()?.some((job) => job.queue === queue && job.jobId === jobId) ?? false
      )
    },
    rejectSelfAdd(queue, jobName, opts) {
      const active = activeJobs
        .getStore()
        ?.find(
          (job) =>
            job.queue === queue &&
            ((opts?.jobId && opts.jobId === job.jobId) ||
              (opts?.deduplication?.id && opts.deduplication.id === job.dedupId)),
        )
      if (!active) return false
      const error: Error & { extra?: Record<string, unknown> } = new Error(
        `Job ${active.jobId} tried to add itself to queue ${queue}`,
      )
      error.extra = {
        queue,
        jobName,
        jobId: opts?.jobId ?? null,
        dedupId: opts?.deduplication?.id ?? null,
        activeJobId: active.jobId,
        activeDedupId: active.dedupId ?? null,
      }
      if (config.throwOnSelfAdd ?? true) throw error
      report(error, 'self_add_guard_reporting_failed')
      return true
    },
  }
}
