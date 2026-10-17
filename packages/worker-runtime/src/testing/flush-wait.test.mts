import type { TestJob } from 'glide-mq/testing'
import { describe, expect, it } from 'vitest'

import { TestQueueFlushTimeoutError } from './flush-diagnostics.mts'
import { type FlushQueue, flushJobs } from './flush-wait.mts'

type Record = { name: string; state: string; failedReason?: string }

function fixture(records: Record[], dead: Array<{ originalJobId?: string }> = []) {
  const map = new Map<string, Record>()
  const jobs = records.map((record, index) => {
    const id = String(index)
    map.set(id, record)
    return { id, _record: record } as unknown as TestJob
  })
  const queue = {
    name: 'fixture',
    jobs: map,
    waitingQueue: [],
    workers: new Set(),
    settleWaiters: new Set<() => void>(),
    getWorkers: async () => [{}],
    getDeadLetterJobs: async () => dead.map((data) => ({ data })),
    isPaused: () => false,
  } as unknown as FlushQueue
  return { queue, jobs, map }
}

describe('flushJobs', () => {
  it('resolves when every job is terminal', async () => {
    const { queue, jobs } = fixture([{ name: 'a', state: 'completed' }])
    await expect(flushJobs(queue, jobs, new Set())).resolves.toBeUndefined()
    expect(queue.settleWaiters.size).toBe(0)
  })

  it('ignores records that were removed from the queue', async () => {
    const { queue, jobs, map } = fixture([{ name: 'a', state: 'active' }])
    map.clear()
    await expect(flushJobs(queue, jobs, new Set())).resolves.toBeUndefined()
  })

  it('names an unknown failure reason', async () => {
    const { queue, jobs } = fixture([{ name: 'a', state: 'failed' }])
    await expect(flushJobs(queue, jobs, new Set())).rejects.toThrow(
      'Test queue job failed in "fixture" (a#0): unknown error',
    )
  })

  it('waits for an expected dead-letter failure to be admitted', async () => {
    const { queue, jobs } = fixture([{ name: 'a', state: 'failed' }], [{ originalJobId: '0' }])
    await expect(flushJobs(queue, jobs, new Set(['0']))).resolves.toBeUndefined()
    const pending = fixture([{ name: 'a', state: 'failed' }], [{}])
    await expect(flushJobs(pending.queue, pending.jobs, new Set(['0']), 20)).rejects.toThrow(
      TestQueueFlushTimeoutError,
    )
  })

  it('wakes on settle notifications and re-inspects', async () => {
    const { queue, jobs, map } = fixture([{ name: 'a', state: 'active' }])
    const flushed = flushJobs(queue, jobs, new Set(), 2_000)
    await new Promise((resolve) => setTimeout(resolve, 10))
    map.get('0')!.state = 'completed'
    for (const waiter of queue.settleWaiters) waiter()
    await expect(flushed).resolves.toBeUndefined()
  })

  it('re-inspects when a transition lands during an awaited read', async () => {
    const { queue, jobs, map } = fixture([{ name: 'a', state: 'active' }], [])
    let reads = 0
    queue.getDeadLetterJobs = async () => {
      reads += 1
      if (reads === 1) {
        map.get('0')!.state = 'completed'
        for (const waiter of queue.settleWaiters) waiter()
      }
      return []
    }
    // The expected id forces the dead-letter read; the completed job never fails, so it settles.
    await expect(flushJobs(queue, jobs, new Set(['0']), 2_000)).resolves.toBeUndefined()
    expect(reads).toBe(2)
  })

  it('bounds an inspection whose read never returns', async () => {
    const { queue, jobs } = fixture([{ name: 'a', state: 'failed' }])
    queue.getDeadLetterJobs = () => new Promise(() => undefined)
    await expect(flushJobs(queue, jobs, new Set(['0']), 20)).rejects.toThrow(
      TestQueueFlushTimeoutError,
    )
    expect(queue.settleWaiters.size).toBe(0)
  })

  it('rejects at once when the deadline already passed', async () => {
    const { queue, jobs } = fixture([{ name: 'a', state: 'active' }])
    queue.getWorkers = async () => {
      await new Promise((resolve) => setTimeout(resolve, 15))
      return [{}] as never
    }
    await expect(flushJobs(queue, jobs, new Set(), 1)).rejects.toThrow(TestQueueFlushTimeoutError)
  })
})
