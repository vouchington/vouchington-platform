import { describe, expect, it } from 'vitest'

import { aggregateQueueStats, getAllQueueStats, getQueueStats, type StatsQueue } from './stats.mts'

const fakeQueue = (n: number, paused = false): StatsQueue => ({
  getJobCounts: async () => ({
    waiting: n,
    active: n + 1,
    delayed: n + 2,
    completed: n + 3,
    failed: n + 4,
  }),
  isPaused: async () => paused,
})

describe('queue stats', () => {
  it('maps counts and paused state', async () => {
    await expect(getQueueStats(fakeQueue(1, true), 'q')).resolves.toEqual({
      name: 'q',
      waiting: 1,
      active: 2,
      delayed: 3,
      completed: 4,
      failed: 5,
      paused: true,
    })
  })

  it('sorts a list by name', async () => {
    const stats = await getAllQueueStats([
      { name: 'b', queue: fakeQueue(10) },
      { name: 'a', queue: fakeQueue(1) },
    ])

    expect(stats.map((entry) => entry.name)).toEqual(['a', 'b'])
  })

  it('aggregates totals', async () => {
    const stats = await getAllQueueStats([
      { name: 'a', queue: fakeQueue(1) },
      { name: 'b', queue: fakeQueue(10) },
    ])

    expect(aggregateQueueStats(stats)).toEqual({
      totalWaiting: 11,
      totalActive: 13,
      totalDelayed: 15,
      totalCompleted: 17,
      totalFailed: 19,
      queueCount: 2,
    })
    expect(aggregateQueueStats([]).queueCount).toBe(0)
  })
})
