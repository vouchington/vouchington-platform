import type { JobOptions, JobTemplate, Queue } from 'glide-mq'

export interface GuardAddInput {
  queueName: string
  jobName: string
  opts?: JobOptions | undefined
}

/** `'skip'` drops the add; otherwise `opts` (when present) replaces the options being added. */
export type GuardAddResult = { opts?: JobOptions } | 'skip'

export type GuardAdd = (input: GuardAddInput) => GuardAddResult

/**
 * Intercepts `add`, `addBulk`, and `upsertJobScheduler` on one queue so an injected guard can drop
 * the call or rewrite its job options. The queue is mutated in place and returned.
 */
export function guardQueueAdds<Q extends Queue<any, any>>(queue: Q, guardAdd: GuardAdd): Q {
  const queueName = queue.name
  const originalAdd = queue.add.bind(queue)
  const originalAddBulk = queue.addBulk.bind(queue)
  const originalUpsert = queue.upsertJobScheduler.bind(queue)

  queue.add = (jobName, data, opts) => {
    const guarded = guardAdd({ queueName, jobName, opts })
    if (guarded === 'skip') return Promise.resolve(null)
    return originalAdd(jobName, data, guarded.opts ?? opts)
  }

  queue.addBulk = (jobs) => {
    const allowed = jobs.flatMap((job) => {
      const guarded = guardAdd({ queueName, jobName: job.name, opts: job.opts })
      if (guarded === 'skip') return []
      const jobOpts = guarded.opts ?? job.opts
      return [jobOpts ? { ...job, opts: jobOpts } : job]
    })
    if (allowed.length === 0) return Promise.resolve([])
    return originalAddBulk(allowed)
  }

  queue.upsertJobScheduler = (schedulerName, schedule, template) => {
    const guarded = guardAdd({
      queueName,
      jobName: template?.name ?? schedulerName,
      opts: template?.opts,
    })
    if (guarded === 'skip') return Promise.resolve()
    const opts = (guarded.opts ?? template?.opts) as JobTemplate['opts']
    return originalUpsert(schedulerName, schedule, opts ? { ...template, opts } : template)
  }

  return queue
}
