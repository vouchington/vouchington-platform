import type { Queue } from 'glide-mq'
import { describe, expect, it, vi } from 'vitest'

import { guardQueueAdds, type GuardAdd } from './guard-add.mts'

function fakeQueue() {
  const add = vi.fn(async () => ({ id: '1' }))
  const addBulk = vi.fn(async (jobs: unknown[]) => jobs.map((_, index) => ({ id: String(index) })))
  const upsertJobScheduler = vi.fn(async () => undefined)
  return { name: 'q', add, addBulk, upsertJobScheduler }
}

function guarded(guard: GuardAdd) {
  const queue = fakeQueue()
  const { add, addBulk, upsertJobScheduler } = queue
  guardQueueAdds(queue as unknown as Queue, guard)
  return { queue: queue as unknown as Queue, add, addBulk, upsertJobScheduler }
}

describe('guardQueueAdds', () => {
  it('passes the queue and job identity to the guard and keeps options when unchanged', async () => {
    const guard = vi.fn<GuardAdd>(() => ({}))
    const { queue, add } = guarded(guard)

    await queue.add('job', { a: 1 }, { attempts: 2 })

    expect(guard).toHaveBeenCalledWith({ queueName: 'q', jobName: 'job', opts: { attempts: 2 } })
    expect(add).toHaveBeenCalledWith('job', { a: 1 }, { attempts: 2 })
  })

  it('skips and rewrites add', async () => {
    const { queue, add } = guarded(({ jobName }) =>
      jobName === 'drop' ? 'skip' : { opts: { priority: 5 } },
    )

    await expect(queue.add('drop', {})).resolves.toBeNull()
    await queue.add('keep', {})

    expect(add).toHaveBeenCalledTimes(1)
    expect(add).toHaveBeenCalledWith('keep', {}, { priority: 5 })
  })

  it('filters and rewrites addBulk, returning [] when everything is skipped', async () => {
    const { queue, addBulk } = guarded(({ jobName }) =>
      jobName === 'drop' ? 'skip' : { opts: { priority: 1 } },
    )

    await queue.addBulk([
      { name: 'drop', data: 1 },
      { name: 'keep', data: 2 },
    ])
    await expect(queue.addBulk([{ name: 'drop', data: 3 }])).resolves.toEqual([])

    expect(addBulk).toHaveBeenCalledTimes(1)
    expect(addBulk).toHaveBeenCalledWith([{ name: 'keep', data: 2, opts: { priority: 1 } }])
  })

  it('keeps each bulk job options when the guard returns none', async () => {
    const { queue, addBulk } = guarded(() => ({}))

    await queue.addBulk([{ name: 'a', data: 1, opts: { attempts: 3 } }])

    expect(addBulk).toHaveBeenCalledWith([{ name: 'a', data: 1, opts: { attempts: 3 } }])
  })

  it('leaves jobs and templates without options untouched when the guard returns none', async () => {
    const { queue, addBulk, upsertJobScheduler } = guarded(() => ({}))

    await queue.addBulk([{ name: 'a', data: 1 }])
    await queue.upsertJobScheduler('s', { every: 1 })

    expect(addBulk).toHaveBeenCalledWith([{ name: 'a', data: 1 }])
    expect(upsertJobScheduler).toHaveBeenCalledWith('s', { every: 1 }, undefined)
  })

  it('guards upsertJobScheduler using the template name or the scheduler name', async () => {
    const guard = vi.fn<GuardAdd>(({ jobName }) =>
      jobName === 'skipped' ? 'skip' : { opts: { priority: 2 } },
    )
    const { queue, upsertJobScheduler } = guarded(guard)

    await queue.upsertJobScheduler('every-hour', { every: 1 }, { name: 'skipped' })
    await queue.upsertJobScheduler('every-day', { every: 2 })
    await queue.upsertJobScheduler('every-week', { every: 3 }, { name: 'tpl', data: 1 })

    expect(guard).toHaveBeenNthCalledWith(1, {
      queueName: 'q',
      jobName: 'skipped',
      opts: undefined,
    })
    expect(upsertJobScheduler).toHaveBeenCalledTimes(2)
    expect(upsertJobScheduler).toHaveBeenNthCalledWith(
      1,
      'every-day',
      { every: 2 },
      { opts: { priority: 2 } },
    )
    expect(upsertJobScheduler).toHaveBeenNthCalledWith(
      2,
      'every-week',
      { every: 3 },
      { name: 'tpl', data: 1, opts: { priority: 2 } },
    )
  })

  it('keeps template options when the guard returns none', async () => {
    const { queue, upsertJobScheduler } = guarded(() => ({}))

    await queue.upsertJobScheduler('s', { every: 1 }, { opts: { attempts: 4 } })

    expect(upsertJobScheduler).toHaveBeenCalledWith('s', { every: 1 }, { opts: { attempts: 4 } })
  })
})
