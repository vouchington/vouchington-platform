import { validateScheduledJobRepeat } from './repeat.mts'
import type {
  ScheduledJobDefinition,
  ScheduledJobManifest,
  ScheduledJobQueue,
  ScheduledJobRepeat,
} from './types.mts'

export type UpsertManifestOptions<J extends ScheduledJobDefinition<any>> = {
  /** Registers only jobs this returns true for (for example an environment filter). */
  include?: (job: J) => boolean
  /** Adjusts each resolved, validated repeat before registration (for example a cadence clamp). */
  transformRepeat?: (repeat: ScheduledJobRepeat, job: J) => ScheduledJobRepeat
}

/**
 * Registers a manifest's schedulers, then removes schedulers on the queue that are no longer in
 * it. Jobs marked `registration: 'sequential'` register alone, in order; consecutive others
 * register in parallel batches.
 */
export async function upsertScheduledJobManifest<J extends ScheduledJobDefinition<any>>(
  queue: ScheduledJobQueue,
  manifest: ScheduledJobManifest<J>,
  options: UpsertManifestOptions<J> = {},
): Promise<void> {
  const jobs = options.include ? manifest.jobs.filter(options.include) : manifest.jobs
  const batches: { parallel: boolean; jobs: J[] }[] = []
  for (const job of jobs) {
    const batch = batches.at(-1)
    if (job.registration === 'sequential') batches.push({ parallel: false, jobs: [job] })
    else if (batch?.parallel) batch.jobs.push(job)
    else batches.push({ parallel: true, jobs: [job] })
  }
  for (const batch of batches) {
    // oxlint-disable-next-line no-await-in-loop -- sequential registration is the contract
    await Promise.all(batch.jobs.map((job) => register(queue, job, options)))
  }
  await removeExtraSchedulers(queue, jobs)
}

/** Removes one scheduler, reporting the scheduler names before and after. */
export async function removeScheduledJobScheduler(
  queue: Pick<ScheduledJobQueue, 'getRepeatableJobs' | 'removeJobScheduler'>,
  schedulerId: string,
): Promise<{ before: readonly string[]; after: readonly string[]; removed: boolean }> {
  const before = (await queue.getRepeatableJobs()).map((entry) => entry.name)
  const removed = before.includes(schedulerId)
  if (removed) await queue.removeJobScheduler(schedulerId)
  const after = (await queue.getRepeatableJobs()).map((entry) => entry.name)
  return { before, after, removed }
}

async function register<J extends ScheduledJobDefinition<any>>(
  queue: ScheduledJobQueue,
  job: J,
  { transformRepeat }: UpsertManifestOptions<J>,
): Promise<unknown> {
  const resolvedRepeat = resolve(job.repeat)
  validateScheduledJobRepeat(resolvedRepeat, job.schedulerId, job.subMinuteJustification)
  const repeat = transformRepeat ? transformRepeat(resolvedRepeat, job) : resolvedRepeat
  const data =
    job.template.dataFactory === undefined ? job.template.data : job.template.dataFactory()
  return queue.upsertJobScheduler(job.schedulerId, repeat, {
    name: job.template.name,
    opts: resolve(job.template.opts),
    ...(data === undefined ? {} : { data }),
  })
}

async function removeExtraSchedulers(
  queue: ScheduledJobQueue,
  jobs: readonly ScheduledJobDefinition<any>[],
): Promise<void> {
  const desired = new Set(jobs.map((job) => job.schedulerId))
  const existing = await queue.getRepeatableJobs()
  await Promise.all(
    existing
      .filter((entry) => !desired.has(entry.name))
      .map((e) => queue.removeJobScheduler(e.name)),
  )
}

function resolve<T>(value: T | (() => T)): T {
  return typeof value === 'function' ? (value as () => T)() : value
}
