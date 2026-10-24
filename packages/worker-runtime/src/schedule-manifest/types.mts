import type { JobTemplate } from 'glide-mq'

export type ScheduledJobRepeat = { pattern: string } | { every: number }

/**
 * Job options a scheduler template may carry. The scheduler tick never applies `delay`,
 * `deduplication`, `parent`, or a fixed `jobId`, so glide-mq rejects them at `upsertJobScheduler`.
 */
export type SchedulerTemplateJobOptions = NonNullable<JobTemplate['opts']>

type ScheduledJobTemplate = {
  name: string
  opts: SchedulerTemplateJobOptions | (() => SchedulerTemplateJobOptions)
} & ({ data?: unknown; dataFactory?: never } | { data?: never; dataFactory: () => unknown })

/**
 * `S` is the application's opaque operator-surface type; it is validated only through the
 * `validateSurface` hook. Applications may extend this type with their own fields (for example an
 * environment tag) and read them in `include` and `transformRepeat`.
 */
export type ScheduledJobDefinition<S = unknown> = {
  schedulerId: string
  repeat: ScheduledJobRepeat | (() => ScheduledJobRepeat)
  template: ScheduledJobTemplate
  /** `'sequential'` registers this job alone, in order, instead of in a parallel batch. */
  registration?: 'sequential'
  operatorSurfaces: readonly [S, ...S[]]
  /** Required when the resolved cadence is faster than the 1-minute scheduling floor. */
  subMinuteJustification?: string
}

export type ScheduledJobManifest<J extends ScheduledJobDefinition<any> = ScheduledJobDefinition> = {
  queueName: string
  jobs: readonly J[]
}

type SurfaceOf<J extends ScheduledJobDefinition<any>> = J['operatorSurfaces'][number]

export type ScheduledJobQueue = {
  upsertJobScheduler: (
    schedulerId: string,
    repeat: ScheduledJobRepeat,
    template: { name: string; data?: unknown; opts: SchedulerTemplateJobOptions },
  ) => Promise<unknown>
  getRepeatableJobs: () => Promise<ReadonlyArray<{ name: string }>>
  removeJobScheduler: (schedulerId: string) => Promise<unknown>
}

export type ManifestValidationOptions<J extends ScheduledJobDefinition<any>> = {
  /** Called for every operator surface of every job; throw to reject it. */
  validateSurface?: (surface: SurfaceOf<J>, schedulerKey: string) => void
}
