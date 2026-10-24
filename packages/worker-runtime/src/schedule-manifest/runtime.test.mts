import { describe, expect, it, vi } from 'vitest'

import { removeScheduledJobScheduler, upsertScheduledJobManifest } from './runtime.mts'
import { toSchedulerTemplateOptions } from './template-options.mts'
import type { ScheduledJobDefinition, ScheduledJobManifest, ScheduledJobQueue } from './types.mts'

type Job = ScheduledJobDefinition<string> & { tag?: string }

const job = (schedulerId: string, overrides: Partial<Job> = {}): Job => ({
  schedulerId,
  repeat: { pattern: '0 * * * *' },
  template: { name: `${schedulerId}-job`, opts: { attempts: 2 } },
  operatorSurfaces: ['surface'],
  ...overrides,
})

const manifest = (...jobs: Job[]): ScheduledJobManifest<Job> => ({ queueName: 'q', jobs })

function fakeQueue(existing: string[] = []) {
  const events: string[] = []
  const queue = {
    upsertJobScheduler: vi.fn(async (id: string) => void events.push(`upsert:${id}`)),
    getRepeatableJobs: vi.fn(async () => existing.map((name) => ({ name }))),
    removeJobScheduler: vi.fn(async (id: string) => void events.push(`remove:${id}`)),
  }
  return { queue: queue as ScheduledJobQueue & typeof queue, events }
}

describe('upsertScheduledJobManifest', () => {
  it('registers every job with its resolved repeat and template', async () => {
    const { queue } = fakeQueue()

    await upsertScheduledJobManifest(
      queue,
      manifest(
        job('a', { template: { name: 'n', opts: { attempts: 1 }, data: { x: 1 } } }),
        job('b', {
          repeat: () => ({ every: 120_000 }),
          template: { name: 'n2', opts: () => ({ attempts: 5 }), dataFactory: () => 'made' },
        }),
        job('c'),
      ),
    )

    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'a',
      { pattern: '0 * * * *' },
      { name: 'n', opts: { attempts: 1 }, data: { x: 1 } },
    )
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'b',
      { every: 120_000 },
      { name: 'n2', opts: { attempts: 5 }, data: 'made' },
    )
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'c',
      { pattern: '0 * * * *' },
      { name: 'c-job', opts: { attempts: 2 } },
    )
  })

  it('validates thunk repeats at registration', async () => {
    const { queue } = fakeQueue()

    await expect(
      upsertScheduledJobManifest(queue, manifest(job('a', { repeat: () => ({ every: 5 }) }))),
    ).rejects.toThrow('below the 60000ms')
    expect(queue.upsertJobScheduler).not.toHaveBeenCalled()
  })

  it('registers sequential jobs alone and in order, between parallel batches', async () => {
    const order: string[] = []
    const gates = new Map<string, () => void>()
    const queue = {
      upsertJobScheduler: vi.fn(
        (id: string) =>
          new Promise<void>((resolve) => {
            order.push(`start:${id}`)
            gates.set(id, () => {
              order.push(`end:${id}`)
              resolve()
            })
          }),
      ),
      getRepeatableJobs: vi.fn(async () => []),
      removeJobScheduler: vi.fn(),
    }
    const done = upsertScheduledJobManifest(
      queue,
      manifest(
        job('p1'),
        job('p2'),
        job('s1', { registration: 'sequential' }),
        job('s2', { registration: 'sequential' }),
        job('p3'),
      ),
    )

    await vi.waitFor(() => expect(order).toEqual(['start:p1', 'start:p2']))
    gates.get('p1')!()
    gates.get('p2')!()
    await vi.waitFor(() => expect(order).toContain('start:s1'))
    expect(order).not.toContain('start:s2')
    gates.get('s1')!()
    await vi.waitFor(() => expect(order).toContain('start:s2'))
    expect(order).not.toContain('start:p3')
    gates.get('s2')!()
    await vi.waitFor(() => expect(order).toContain('start:p3'))
    gates.get('p3')!()
    await done
  })

  it('removes schedulers that are no longer in the manifest, after registering', async () => {
    const { queue, events } = fakeQueue(['a', 'stale', 'older'])

    await upsertScheduledJobManifest(queue, manifest(job('a')))

    expect(events).toEqual(['upsert:a', 'remove:stale', 'remove:older'])
  })

  it('applies include to registration and to extra-scheduler removal', async () => {
    const { queue, events } = fakeQueue(['kept', 'excluded'])

    await upsertScheduledJobManifest(
      queue,
      manifest(job('kept', { tag: 'on' }), job('excluded', { tag: 'off' })),
      { include: (candidate) => candidate.tag !== 'off' },
    )

    expect(events).toEqual(['upsert:kept', 'remove:excluded'])
  })

  it('applies transformRepeat to the resolved repeat with the job', async () => {
    const { queue } = fakeQueue()
    const transformRepeat = vi.fn(() => ({ pattern: '0 0 * * *' }))

    await upsertScheduledJobManifest(
      queue,
      manifest(job('a', { repeat: () => ({ every: 90_000 }) })),
      {
        transformRepeat,
      },
    )

    expect(transformRepeat).toHaveBeenCalledWith(
      { every: 90_000 },
      expect.objectContaining({ schedulerId: 'a' }),
    )
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'a',
      { pattern: '0 0 * * *' },
      expect.anything(),
    )
  })
})

describe('removeScheduledJobScheduler', () => {
  it('removes an existing scheduler and reports before and after', async () => {
    const names = ['a', 'b']
    const queue = {
      getRepeatableJobs: vi.fn(async () => names.map((name) => ({ name }))),
      removeJobScheduler: vi.fn(async (id: string) => void names.splice(names.indexOf(id), 1)),
    }

    await expect(removeScheduledJobScheduler(queue, 'a')).resolves.toEqual({
      before: ['a', 'b'],
      after: ['b'],
      removed: true,
    })
  })

  it('does not call remove for an unknown scheduler', async () => {
    const queue = {
      getRepeatableJobs: vi.fn(async () => [{ name: 'a' }]),
      removeJobScheduler: vi.fn(),
    }

    await expect(removeScheduledJobScheduler(queue, 'zzz')).resolves.toEqual({
      before: ['a'],
      after: ['a'],
      removed: false,
    })
    expect(queue.removeJobScheduler).not.toHaveBeenCalled()
  })
})

describe('toSchedulerTemplateOptions', () => {
  it('drops delay, deduplication, parent, and jobId and keeps the rest', () => {
    expect(
      toSchedulerTemplateOptions({
        attempts: 3,
        priority: 2,
        delay: 10,
        jobId: 'fixed',
        deduplication: { id: 'x' },
        parent: { id: 'p', queue: 'q' },
      }),
    ).toEqual({ attempts: 3, priority: 2 })
  })
})
