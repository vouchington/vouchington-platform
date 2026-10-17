import type { JobOptions } from 'glide-mq'
import type { TestJob } from 'glide-mq/testing'

import { type FlushQueue, flushJobs } from './flush-wait.mts'
import { isInsideTestWorkerProcessor } from './processor-context.mts'

export type TestJobOptions = JobOptions & {
  /** Treat a failure that lands on the dead-letter queue as an expected terminal state. */
  expectDeadLetter?: boolean
  /** Override the flush deadline for this add. */
  flushTimeoutMs?: number
}

function stripTestJobOptions(opts?: TestJobOptions): JobOptions | undefined {
  if (!opts) return undefined
  const { expectDeadLetter: _expectDeadLetter, flushTimeoutMs: _flushTimeoutMs, ...jobOpts } = opts
  return jobOpts
}

/** Enqueue one job, then wait for attached workers to settle it (unless called from a processor). */
export async function addAndFlush<D, R>(
  queue: FlushQueue<D, R>,
  name: string,
  data: D,
  opts?: TestJobOptions,
) {
  const job = await queue.enqueue(name, data, stripTestJobOptions(opts))
  if (job && !isInsideTestWorkerProcessor()) {
    await flushJobs(
      queue,
      [job],
      opts?.expectDeadLetter === true ? new Set([job.id]) : new Set(),
      opts?.flushTimeoutMs,
    )
  }
  return job
}

/** Enqueue jobs in order, then flush the admitted ones; returns the SDK's compact list. */
export async function addBulkAndFlush<D, R>(
  queue: FlushQueue<D, R>,
  jobs: Array<{ name: string; data: D; opts?: TestJobOptions }>,
) {
  const result: TestJob<D, R>[] = []
  const expectedDeadLetterJobIds = new Set<string>()
  for (const job of jobs) {
    const added = await queue.enqueue(job.name, job.data, stripTestJobOptions(job.opts))
    if (!added) continue
    result.push(added)
    if (job.opts?.expectDeadLetter === true) expectedDeadLetterJobIds.add(added.id)
  }
  const timeouts = jobs.flatMap((job) =>
    typeof job.opts?.flushTimeoutMs === 'number' ? [job.opts.flushTimeoutMs] : [],
  )
  if (result.length > 0 && !isInsideTestWorkerProcessor()) {
    await flushJobs(
      queue,
      result,
      expectedDeadLetterJobIds,
      timeouts.length > 0 ? Math.max(...timeouts) : undefined,
    )
  }
  return result
}
