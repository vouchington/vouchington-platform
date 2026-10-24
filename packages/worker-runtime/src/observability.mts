import type { Job, Worker } from 'glide-mq'

import type { WorkerLogger } from './logger.mts'

export type WorkerLifecycleEvent = 'drained' | 'closed' | 'closing' | 'ready'
export type JobProgressEvent = 'active' | 'stalled' | 'progress'

export interface WorkerObservabilityHooks {
  /** Receives worker errors and failed jobs, decorated with queue and job tags. */
  onError: (error: Error) => void
  onWorkerEvent?: (queueName: string, event: WorkerLifecycleEvent) => void
  /** `jobRef` is the job name, or the job id for `stalled`. */
  onJobProgress?: (queueName: string, jobRef: string, event: JobProgressEvent) => void
  onJobCompleted?: (
    queueName: string,
    jobName: string,
    status: 'completed' | 'failed',
    durationMs: number,
  ) => void
  /** Failures this returns true for are not logged to the console (they are still reported). */
  isExpectedError?: (error: Error) => boolean
  /** Scrubs job data before it reaches logs or error context. Without it, no job data is attached. */
  scrubJobData?: (data: unknown) => Record<string, unknown> | undefined
  /** Formats the error printed for failed jobs. Default: the stack, or the string form. */
  formatError?: (error: Error) => string
  logger?: WorkerLogger
}

type Scalar = string | number | boolean
type DecoratedError = Error & { tags?: Record<string, Scalar>; extra?: Record<string, unknown> }

/** Wires a GlideMQ worker's events to injected logging, tracking, and error-reporting hooks. */
export function addWorkerEventListeners(worker: Worker, hooks: WorkerObservabilityHooks): void {
  const queue = worker.name
  const { logger } = hooks
  worker.on('error', hooks.onError)
  for (const event of ['drained', 'closed', 'closing', 'ready'] as const) {
    worker.on(event, () => hooks.onWorkerEvent?.(queue, event))
  }

  worker.on('active', (job: Job) => {
    logger?.onActive(queue, job)
    hooks.onJobProgress?.(queue, job.name, 'active')
  })
  worker.on('stalled', (jobId: string) => hooks.onJobProgress?.(queue, jobId, 'stalled'))
  worker.on('progress', (job: Job) => hooks.onJobProgress?.(queue, job.name, 'progress'))

  worker.on('failed', (job: Job | undefined, error: Error) => onFailed(queue, hooks, job, error))
  worker.on('completed', (job: Job) => {
    logger?.onCompleted(queue, job)
    hooks.onJobCompleted?.(queue, job.name, 'completed', getDuration(job))
  })
}

function onFailed(
  queue: string,
  hooks: WorkerObservabilityHooks,
  job: Job | undefined,
  error: Error,
): void {
  if (job) {
    const jobData = hooks.scrubJobData?.(job.data)
    if (!hooks.isExpectedError?.(error)) logFailure(queue, hooks, job, error, jobData)
    hooks.onJobCompleted?.(queue, job.name, 'failed', getDuration(job))

    // Attach job context so the error reporter receives queue and job metadata.
    const decorated = error as DecoratedError
    decorated.tags = {
      ...decorated.tags,
      queue,
      job_name: job.name,
      ...(job.id != null && { job_id: job.id }),
    }
    decorated.extra = {
      ...decorated.extra,
      job_name: job.name,
      ...(job.opts?.attempts != null && { attempts: job.opts.attempts }),
      ...(jobData && { job_data: jobData }),
    }
  }
  hooks.onError(error)
}

function logFailure(
  queue: string,
  hooks: WorkerObservabilityHooks,
  job: Job,
  error: Error,
  jobData: Record<string, unknown> | undefined,
): void {
  if (hooks.logger?.isEnabled()) {
    hooks.logger.onFailed(queue, job, error)
    return
  }
  console.error(
    'job failed: %s %o (%dms) %s',
    job.name,
    { queue, job_id: job.id ?? 'unknown', ...(jobData && { job_data: jobData }) },
    getDuration(job),
    hooks.formatError?.(error) ?? error.stack ?? String(error),
  )
}

function getDuration(job: Job): number {
  return job.processedOn && job.finishedOn
    ? job.finishedOn - job.processedOn
    : (job.finishedOn || Date.now()) - (job.processedOn || Date.now())
}
