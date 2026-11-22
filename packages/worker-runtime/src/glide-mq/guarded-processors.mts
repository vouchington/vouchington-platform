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
import { batchResults, selfAddError, toError } from './guarded-batch.mts'
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
  const activeJobs = new AsyncLocalStorage<{ jobs: ActiveJob[]; active: boolean }>()
  const current = () => {
    const scope = activeJobs.getStore()
    return scope?.active ? scope.jobs : undefined
  }
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
    const results = await Promise.allSettled(releases.map(async (release) => release()))
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
        const scope = { jobs: [activeJob(queue, job)], active: true }
        try {
          return await activeJobs.run(scope, () => processor(job))
        } finally {
          scope.active = false
          await releaseAll([release])
        }
      }
    },
    wrapBatchProcessor(processor, queue, options) {
      return async (jobs) => {
        const releases: Release[] = []
        const runnable: Job<any, any>[] = []
        // Fixed outcomes: a deferral, or the error of a failed admission (admitted jobs then never run).
        const outcome = new Map<Job<any, any>, Error>()
        let admissionError: Error | undefined
        let failure: Error | undefined
        let partial = false
        let values: unknown[] = []
        const scope = { jobs: [] as ActiveJob[], active: true }
        let result: unknown[]
        try {
          for (const job of jobs) {
            if (admissionError) {
              outcome.set(job, admissionError)
              continue
            }
            try {
              // oxlint-disable-next-line no-await-in-loop -- preserve batch order when two jobs share a scheduler lease
              const release = await config.lease(queue, job, options, jobs)
              if (release) {
                releases.push(release)
                runnable.push(job)
              }
            } catch (err) {
              // The batch path ignores moveToDelayed, so a deferral must not abort the batch.
              if (err instanceof DelayedError) outcome.set(job, err)
              else {
                admissionError = toError(err)
                outcome.set(job, admissionError)
              }
            }
          }
          if (admissionError) for (const job of runnable.splice(0)) outcome.set(job, admissionError)
          scope.jobs = runnable.map((job) => activeJob(queue, job))
          if (runnable.length) {
            try {
              // The processor may consume its input, so it gets a copy of the admission order.
              values = await activeJobs.run(scope, () => processor([...runnable]))
              if (!Array.isArray(values) || values.length !== runnable.length) {
                const count = Array.isArray(values) ? values.length : 'non-array'
                throw new Error(
                  `Batch processor returned ${count} results but batch had ${runnable.length} jobs`,
                )
              }
            } catch (err) {
              const partialResults = batchResults(err)
              partial = partialResults !== null
              if (partialResults) values = partialResults
              else failure = toError(err)
            }
          }
          // Results are positional against the original batch, not the runnable subset.
          result = jobs.map((job) => {
            if (outcome.has(job)) return outcome.get(job)
            const index = runnable.indexOf(job)
            if (index < 0) return undefined
            if (failure) return failure
            return partial && index >= values.length
              ? new Error('No result in BatchError')
              : values[index]
          })
        } finally {
          scope.active = false
          await releaseAll(releases)
        }
        // When every job fails the same way, the original error reaches the worker unchanged.
        if (failure && runnable.length === jobs.length) throw failure
        if (admissionError && jobs.every((job) => outcome.get(job) === admissionError))
          throw admissionError
        // A deferred job reports its DelayedError as a per-job failure, so the worker retries it
        // through its normal attempts and backoff instead of resolving it as a success. Skipped
        // ticks stay successes because the worker reads results by original position.
        if (partial || failure || outcome.size > 0) throw new BatchError(result)
        return result as never
      }
    },
    isActiveProcessorJob(queue, jobId) {
      if (!jobId) return false
      return current()?.some((job) => job.queue === queue && job.jobId === jobId) ?? false
    },
    rejectSelfAdd(queue, jobName, opts) {
      const active = current()?.find(
        (job) =>
          job.queue === queue &&
          ((opts?.jobId && opts.jobId === job.jobId) ||
            (opts?.deduplication?.id && opts.deduplication.id === job.dedupId)),
      )
      if (!active) return false
      const error = selfAddError(active, queue, jobName, opts)
      if (config.throwOnSelfAdd ?? true) throw error
      report(error, 'self_add_guard_reporting_failed')
      return true
    },
  }
}
