import type { JobOptions } from 'glide-mq'

import type { SchedulerTemplateJobOptions } from './types.mts'

/**
 * Adapts job options shared with a manual-trigger enqueue to a scheduler template, dropping
 * `delay`, `deduplication`, `parent`, and `jobId`, which glide-mq rejects at `upsertJobScheduler`.
 */
export function toSchedulerTemplateOptions(opts: JobOptions): SchedulerTemplateJobOptions {
  const {
    delay: _delay,
    deduplication: _deduplication,
    parent: _parent,
    jobId: _jobId,
    ...templateOptions
  } = opts
  return templateOptions
}
