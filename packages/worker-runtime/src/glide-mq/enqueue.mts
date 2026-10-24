import type { JobOptions, Queue } from 'glide-mq'

import { publishEnqueueAdmission } from './admission.mts'

export const ENQUEUE_BASE_DEFAULTS = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 1000, jitter: 0.5 },
  removeOnComplete: 100,
  removeOnFail: 100,
} satisfies JobOptions

export type ErrorWithReportingContext = Error & {
  extra?: Record<string, unknown> | null
  tags?: Record<string, string | number | boolean> | null
}

export type EnqueueErrorContext<TCallContext = unknown> = {
  queueName: string
  jobName: string
  count: number
  callContext?: TCallContext | undefined
}

type EnqueueHooks<TCallContext> = {
  queueName: string
  jobName: string
  /** Job options applied over the base defaults and under per-call options. */
  defaults?: Partial<JobOptions>
  /** Forces the completed and failed job records to be removed. */
  sensitive?: boolean
  /** Whether to wrap the add in `retryFn`. Default true. */
  retry?: boolean
  /** Retries a transient enqueue failure; applied unless `retry` is false. */
  retryFn?: <T>(fn: () => Promise<T>) => Promise<T>
  /** Adjusts or checks the merged options for one job (for example a priority contract). */
  normalizeOptions?: (
    options: JobOptions,
    job: { queueName: string; jobName: string; data: unknown },
  ) => JobOptions
  /** Called once per enqueue with the number of jobs, for example to track metrics. */
  onEnqueue?: (queueName: string, jobName: string, count: number) => void
  decorateError?: (
    error: ErrorWithReportingContext,
    context: EnqueueErrorContext<TCallContext>,
  ) => Error
  /** Receives rejected enqueues (decorated) and failing admission observers. */
  reportError: (error: Error) => void
}

export type CreateEnqueueFunctionOptions<
  TName extends string,
  TCallContext = unknown,
> = EnqueueHooks<TCallContext> & {
  queue: Pick<Queue, 'add'>
  jobName: TName
}

export type CreateBulkEnqueueFunctionOptions<
  TInput,
  TData,
  TName extends string,
  TCallContext = unknown,
> = EnqueueHooks<TCallContext> & {
  queue: Pick<Queue, 'addBulk'>
  jobName: TName
  buildJob: (input: TInput, index: number) => { data: TData; opts?: Partial<JobOptions> }
  /** Replaces `queue.addBulk` (for example to add fences or recovery); it owns its own retry. */
  addBulk?: (
    jobs: { name: string; data: TData; opts: JobOptions }[],
  ) => ReturnType<Queue['addBulk']>
}

/** Builds an enqueue function: merged options, optional retry, reporting, admission, and tracking. */
export function createEnqueueFunction<TData, TName extends string, TCallContext = unknown>(
  options: CreateEnqueueFunctionOptions<TName, TCallContext>,
) {
  return (
    data: TData,
    perCallOpts?: Partial<JobOptions>,
    callContext?: TCallContext,
  ): ReturnType<Queue['add']> => {
    const merged = finalizeOptions(options, data, options.defaults, perCallOpts)
    const add = () => options.queue.add(options.jobName, data, merged)
    const job = options.retry !== false && options.retryFn ? options.retryFn(add) : add()
    return track(options, job, [data], 1, callContext)
  }
}

/** Builds a bulk enqueue function; an empty input resolves `[]` without touching the queue. */
export function createBulkEnqueueFunction<
  TInput,
  TData,
  TName extends string,
  TCallContext = unknown,
>(options: CreateBulkEnqueueFunctionOptions<TInput, TData, TName, TCallContext>) {
  return (
    inputs: TInput[],
    perCallOpts?: Partial<JobOptions>,
    callContext?: TCallContext,
  ): ReturnType<Queue['addBulk']> => {
    if (inputs.length === 0) return Promise.resolve([])
    const jobs = inputs.map((input, index) => {
      const built = options.buildJob(input, index)
      const opts = finalizeOptions(options, built.data, options.defaults, built.opts, perCallOpts)
      return { name: options.jobName, data: built.data, opts }
    })
    const addBulk = () => options.queue.addBulk(jobs)
    const promise =
      options.addBulk?.(jobs) ??
      (options.retry !== false && options.retryFn ? options.retryFn(addBulk) : addBulk())
    return track(
      options,
      promise,
      jobs.map((job) => job.data),
      inputs.length,
      callContext,
    )
  }
}

function finalizeOptions(
  options: EnqueueHooks<never>,
  data: unknown,
  ...layers: Array<Partial<JobOptions> | undefined>
): JobOptions {
  const merged = Object.assign({}, ENQUEUE_BASE_DEFAULTS, ...layers) as JobOptions
  // Copy the nested backoff so a normalizer that edits it in place cannot change the shared default.
  if (typeof merged.backoff === 'object') merged.backoff = { ...merged.backoff }
  const retained = options.sensitive
    ? { ...merged, removeOnComplete: true, removeOnFail: true }
    : merged
  return options.normalizeOptions
    ? options.normalizeOptions(retained, {
        queueName: options.queueName,
        jobName: options.jobName,
        data,
      })
    : retained
}

function track<T extends Promise<unknown>, TCallContext>(
  options: EnqueueHooks<TCallContext> & { queue: object },
  promise: T,
  inputs: readonly unknown[],
  count: number,
  callContext: TCallContext | undefined,
): T {
  promise.catch((error: unknown) => {
    const err: ErrorWithReportingContext =
      error instanceof Error ? error : new Error(String(error), { cause: error })
    const context = { queueName: options.queueName, jobName: options.jobName, count, callContext }
    try {
      options.reportError(options.decorateError?.(err, context) ?? err)
    } catch {
      // The caller still holds the original rejection; a failing reporter must not add another.
    }
  })
  publishEnqueueAdmission(
    {
      queue: options.queue,
      queueName: options.queueName,
      jobName: options.jobName,
      inputs,
      completion: promise,
    },
    options.reportError,
  )
  try {
    options.onEnqueue?.(options.queueName, options.jobName, count)
  } catch (error) {
    // Instrumentation must not turn an admitted enqueue into an apparent failure.
    try {
      options.reportError(
        error instanceof Error ? error : new Error(String(error), { cause: error }),
      )
    } catch {
      // Nothing further to do.
    }
  }
  return promise
}
