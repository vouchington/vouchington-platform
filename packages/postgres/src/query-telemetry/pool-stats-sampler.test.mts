import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPoolStatsSampler, type PoolStatsTimer } from './pool-stats-sampler.mts'

const pools = {
  write: { pool: { totalCount: 4, idleCount: 1, waitingCount: 2 }, max: 10 },
  read: { pool: { totalCount: 1, idleCount: 1, waitingCount: 0 }, max: 5 },
}

function fakeSchedule() {
  const unref = vi.fn()
  const dispose = vi.fn()
  const timer: PoolStatsTimer = { unref, dispose }
  let tick: () => void = () => undefined
  const schedule = vi.fn((callback: () => void) => {
    tick = callback
    return timer
  })
  return { unref, dispose, schedule, tick: () => tick() }
}

afterEach(() => vi.useRealTimers())

describe('createPoolStatsSampler', () => {
  it('emits one entry per pool on each tick and unrefs the timer', async () => {
    const emit = vi.fn()
    const { unref, schedule, tick } = fakeSchedule()
    await using sampler = createPoolStatsSampler({ pools, emit, intervalMs: 5, schedule })
    sampler.start()
    sampler.start()
    expect(schedule).toHaveBeenCalledExactlyOnceWith(expect.any(Function), 5)
    expect(unref).toHaveBeenCalledOnce()
    tick()
    await vi.waitFor(() => expect(emit).toHaveBeenCalledOnce())
    expect(emit.mock.calls[0]?.[0]).toEqual([
      { pool: 'write', total: 4, idle: 1, waiting: 2, max: 10 },
      { pool: 'read', total: 1, idle: 1, waiting: 0, max: 5 },
    ])
    expect(emit.mock.calls[0]?.[1]).toBeInstanceOf(Date)
  })

  it('stops on dispose and restarts afterwards', async () => {
    const { dispose, schedule } = fakeSchedule()
    const sampler = createPoolStatsSampler({ pools, emit: vi.fn(), schedule })
    sampler.stop()
    sampler.start()
    await sampler[Symbol.asyncDispose]()
    expect(dispose).toHaveBeenCalledOnce()
    sampler.start()
    expect(schedule).toHaveBeenCalledTimes(2)
    expect(schedule).toHaveBeenLastCalledWith(expect.any(Function), 60_000)
  })

  it('reports emit failures and keeps sampling', async () => {
    const reportError = vi.fn()
    const emit = vi.fn().mockRejectedValueOnce(new Error('sink down')).mockRejectedValueOnce('odd')
    const sampler = createPoolStatsSampler({ pools, emit, reportError })
    await sampler.sample()
    await sampler.sample()
    expect(reportError.mock.calls.map(([error]) => (error as Error).message)).toEqual([
      'sink down',
      'odd',
    ])
  })

  it('swallows emit failures when no reporter is given', async () => {
    const emit = vi.fn().mockRejectedValue(new Error('ignored'))
    await expect(createPoolStatsSampler({ pools, emit }).sample()).resolves.toBeUndefined()
  })

  it('uses a real interval by default', async () => {
    vi.useFakeTimers()
    const emit = vi.fn()
    const sampler = createPoolStatsSampler({ pools, emit, intervalMs: 1000 })
    sampler.start()
    await vi.advanceTimersByTimeAsync(2000)
    expect(emit).toHaveBeenCalledTimes(2)
    sampler.stop()
    await vi.advanceTimersByTimeAsync(2000)
    expect(emit).toHaveBeenCalledTimes(2)
  })
})
