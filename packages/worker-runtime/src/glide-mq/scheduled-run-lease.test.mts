import { describe, expect, it, vi } from 'vitest'
import { DelayedError, type Job } from 'glide-mq'
import {
  createScheduledRunLease,
  type ScheduledRunLeaseClient,
  type ScheduledRunLeaseConfig,
} from './scheduled-run-lease.mts'
import { ADMIT_SCHEDULED_RUN_LUA, RELEASE_SCHEDULED_RUN_LUA } from './scheduled-run-scripts.mts'

const ADMIT_KEYS = ['glide:{q}:run:nightly', 'glide:{q}:job:j1', 'glide:{q}:run-metrics']

function setup(decision: unknown, overrides: Partial<ScheduledRunLeaseClient> = {}) {
  const base = {
    hget: vi.fn(async () => null),
    get: vi.fn(async () => null),
    set: vi.fn(async (_key: string, _value: string, _expiryMs: number) => 'OK'),
    hincrBy: vi.fn(async () => 1),
    runScript: vi.fn(async (lua: string, _keys: string[], _args: string[]) =>
      lua === ADMIT_SCHEDULED_RUN_LUA ? decision : 1,
    ),
  }
  const client = { ...base, ...overrides } as typeof base
  const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const onError = vi.fn()
  const config: ScheduledRunLeaseConfig = { client, logger, onError }
  return { client, logger, onError, lease: createScheduledRunLease(config), config }
}

function job(overrides: Record<string, unknown> = {}): Job {
  return {
    id: 'j1',
    schedulerName: 'nightly',
    opts: {},
    moveToDelayed: vi.fn(async () => {}),
    ...overrides,
  } as unknown as Job
}

describe('createScheduledRunLease', () => {
  it('lets jobs without a scheduler run without touching the client', async () => {
    const { client, lease } = setup(1)
    const release = await lease('q', job({ schedulerName: undefined }), {})
    await release?.()
    expect(client.runScript).not.toHaveBeenCalled()
  })

  it('rejects identical admitted and skipped field names', () => {
    const { config } = setup(1)
    expect(() =>
      createScheduledRunLease({ ...config, admittedField: 'state', skippedField: 'state' }),
    ).toThrow('admittedField and skippedField must differ')
  })

  it('rounds a fractional runtime bound up to integer milliseconds', async () => {
    const { client, lease } = setup(1)
    await lease('q', job({ opts: { timeout: 1500.5 } }), {})
    expect(client.runScript.mock.calls[0]![2][4]).toBe('1501')
    expect(client.set).toHaveBeenCalledWith('glide:{q}:run-previous:nightly', 'j1', 3002)
  })

  it('sizes the lease from the longest timeout in the batch', async () => {
    const { client, lease } = setup(1)
    const short = job({ opts: { timeout: 1000 } })
    const long = job({ id: 'j2', opts: { timeout: 9000 } })
    await lease('q', short, {}, [short, long])
    expect(client.runScript.mock.calls[0]![2][4]).toBe('9000')
  })

  it('keeps the previous-holder marker disjoint from another scheduler lease key', async () => {
    const { client, lease } = setup(1)
    await lease('q', job({ schedulerName: 'foo' }), {})
    const marker = client.set.mock.calls[0]![0]
    await lease('q', job({ schedulerName: 'foo:previous' }), {})
    const leaseKey = client.runScript.mock.calls.at(-1)![1][0]
    expect(marker).not.toBe(leaseKey)
  })

  it('acquires the lease, records the holder, and releases through Lua', async () => {
    const { client, lease } = setup(1)
    const release = await lease('q', job(), { lockDuration: 1000, maxStalledCount: 1 })
    expect(client.runScript).toHaveBeenCalledWith(ADMIT_SCHEDULED_RUN_LUA, ADMIT_KEYS, [
      'j1',
      'nightly',
      'scheduledRunLeaseAdmitted',
      'scheduledRunLeaseSkipped',
      '2000',
      'skipped_overlap',
    ])
    expect(client.set).toHaveBeenCalledWith('glide:{q}:run-previous:nightly', 'j1', 4000)
    await release?.()
    expect(client.runScript).toHaveBeenLastCalledWith(
      RELEASE_SCHEDULED_RUN_LUA,
      ['glide:{q}:run:nightly', 'glide:{q}:run-previous:nightly'],
      ['j1'],
    )
  })

  it('shortens the ttl to the scheduler interval and honors prefixes and custom names', async () => {
    const { client, config } = setup(2, {
      hget: vi.fn(async () => Buffer.from(JSON.stringify({ every: 500 }))),
    })
    const lease = createScheduledRunLease({
      ...config,
      prefix: 'configured',
      admittedField: 'a',
      skippedField: 's',
      skippedMetric: 'skips',
      deferredMetric: 'defers',
      defaultLockDurationMs: 9000,
      defaultMaxStalledCount: 0,
    })
    await lease('q', job(), {})
    expect(client.hget).toHaveBeenCalledWith('configured:{q}:schedulers', 'nightly')
    const admit = client.runScript.mock.calls[0]!
    expect(admit[1]![0]).toBe('configured:{q}:run:nightly')
    expect(admit[2]).toEqual(['j1', 'nightly', 'a', 's', '500', 'skips'])
    await lease('q', job(), { prefix: 'worker' })
    expect(client.runScript.mock.calls[1]![1]![0]).toBe('worker:{q}:run:nightly')
  })

  it('derives the interval from run times, and ignores unusable scheduler entries', async () => {
    const cases: Array<[string | null, string]> = [
      [JSON.stringify({ nextRun: 5000, lastRun: 2000 }), '3000'],
      [JSON.stringify({ nextRun: 1000, lastRun: 2000 }), '90000'],
      [JSON.stringify({ every: 0 }), '90000'],
      ['not json', '90000'],
      [null, '90000'],
    ]
    for (const [entry, ttl] of cases) {
      const { client, lease } = setup(1, { hget: vi.fn(async () => entry) })
      // eslint-disable-next-line no-await-in-loop
      await lease('q', job({ opts: { timeout: 90_000 } }), { lockDuration: 1 })
      expect(client.runScript.mock.calls[0]![2]![4]).toBe(ttl)
    }
  })

  it('uses a job-level lock duration and a floor of one millisecond', async () => {
    const { client, lease } = setup(1)
    await lease('q', job({ opts: { lockDuration: 100 } }), { lockDuration: 1, maxStalledCount: 0 })
    expect(client.runScript.mock.calls[0]![2]![4]).toBe('100')
    const tiny = setup(1, { hget: vi.fn(async () => JSON.stringify({ every: 0.5 })) })
    await tiny.lease('q', job(), {})
    expect(tiny.client.runScript.mock.calls[0]![2]![4]).toBe('1')
  })

  it('treats a zero job timeout as no timeout', async () => {
    const { client, lease } = setup(1)
    await lease('q', job({ opts: { timeout: 0 } }), { lockDuration: 1000, maxStalledCount: 1 })
    expect(client.runScript.mock.calls[0]![2]![4]).toBe('2000')
  })

  it('warns when a different job held the previous lease and accepts the same job', async () => {
    const decoder = new TextEncoder()
    const { logger, lease } = setup(2, { get: vi.fn(async () => decoder.encode('other')) })
    await lease('q', job(), {})
    expect(logger.warn).toHaveBeenCalledWith('overlap_lease_expired', {
      queue: 'q',
      scheduler: 'nightly',
      jobId: 'j1',
      previousJobId: 'other',
    })
    const same = setup(1, { get: vi.fn(async () => 'j1') })
    await same.lease('q', job(), {})
    expect(same.logger.warn).not.toHaveBeenCalled()
  })

  it('releases the lease and rethrows when bookkeeping fails, even if the release also fails', async () => {
    const failure = new Error('wrong type')
    const { client, logger, lease } = setup(1, {
      get: vi.fn(async () => {
        throw failure
      }),
    })
    await expect(lease('q', job(), {})).rejects.toBe(failure)
    expect(client.runScript).toHaveBeenLastCalledWith(
      RELEASE_SCHEDULED_RUN_LUA,
      expect.any(Array),
      ['j1'],
    )
    const releaseFailure = new Error('release failed')
    client.runScript.mockImplementation(async (lua: string) => {
      if (lua === RELEASE_SCHEDULED_RUN_LUA) throw releaseFailure
      return 1
    })
    await expect(lease('q', job(), {})).rejects.toBe(failure)
    expect(logger.error).toHaveBeenCalledWith(
      'scheduled_lease_bookkeeping_release_failed',
      releaseFailure,
    )
  })

  it('reports a failed scheduler read and still admits, falling back to the logger', async () => {
    const readFailure = new Error('read failed')
    const { client, onError, lease, logger, config } = setup(1, {
      hget: vi.fn(async () => {
        throw readFailure
      }),
    })
    await lease('q', job(), {})
    expect(onError).toHaveBeenCalledWith(readFailure)
    const throwing = createScheduledRunLease({
      ...config,
      onError: () => {
        throw new Error('reporter down')
      },
    })
    await throwing('q', job(), {})
    expect(logger.error).toHaveBeenCalledWith(
      'scheduled_interval_reporting_failed',
      new Error('reporter down'),
    )
    expect(client.runScript).toHaveBeenCalledTimes(2)
  })

  it('wraps a non-error read failure and tolerates a missing reporter', async () => {
    const { onError, lease } = setup(1, {
      hget: vi.fn(async () => Promise.reject('plain')),
    })
    await lease('q', job(), {})
    expect(onError).toHaveBeenCalledWith(new Error('plain'))
    const quiet = setup(1, { hget: vi.fn(async () => Promise.reject(new Error('x'))) })
    await createScheduledRunLease({ client: quiet.client, logger: quiet.logger })('q', job(), {})
    expect(quiet.logger.error).not.toHaveBeenCalled()
  })

  it('skips a recovered tick without counting it again', async () => {
    const { logger, lease } = setup(4)
    expect(await lease('q', job(), {})).toBeNull()
    expect(logger.info).toHaveBeenCalledWith('skipped_overlap', {
      queue: 'q',
      scheduler: 'nightly',
      jobId: 'j1',
      recovered: true,
    })
  })

  it('skips a fresh overlapping tick', async () => {
    const { client, lease, logger } = setup(0)
    expect(await lease('q', job(), {})).toBeNull()
    expect(logger.info).toHaveBeenCalledWith('skipped_overlap', expect.any(Object))
    expect(client.hincrBy).not.toHaveBeenCalled()
  })

  it('defers retained admitted work and counts it', async () => {
    const { client, lease, logger } = setup(3)
    const delayed = new DelayedError(1)
    const moveToDelayed = vi.fn(async () => Promise.reject(delayed))
    const retained = job({ opts: { lockDuration: 5000 }, moveToDelayed })
    const before = Date.now()
    await expect(lease('q', retained, {})).rejects.toBe(delayed)
    expect(client.hincrBy).toHaveBeenCalledWith('glide:{q}:run-metrics', 'deferred_admitted', 1)
    expect(logger.info).toHaveBeenCalledWith('deferred_admitted', expect.any(Object))
    const delayedTo = (moveToDelayed.mock.calls[0] as unknown as [number])[0]
    expect(delayedTo).toBeGreaterThanOrEqual(before + 1000)
  })

  it('still defers when the deferred-metric write and its reporting fail', async () => {
    const { lease, onError, logger } = setup(3, {
      hincrBy: vi.fn(async () => Promise.reject(new Error('metric'))),
    })
    onError.mockImplementation(() => {
      throw new Error('reporter')
    })
    const delayed = new DelayedError(1)
    const moveToDelayed = vi.fn(async () => Promise.reject(delayed))
    await expect(lease('q', job({ moveToDelayed }), {})).rejects.toBe(delayed)
    expect(moveToDelayed).toHaveBeenCalledOnce()
    expect(logger.error).toHaveBeenCalledWith(
      'scheduled_overlap_metric_reporting_failed',
      new Error('reporter'),
    )
  })

  it('reports a failed overlap metric increment while still skipping', async () => {
    const { lease, onError } = setup(5)
    expect(await lease('q', job(), {})).toBeNull()
    expect(onError).toHaveBeenCalledWith(
      new Error('Scheduled overlap metric increment failed for q/nightly'),
    )
  })

  it('logs to the console by default', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => {})
    const { client } = setup(0)
    await createScheduledRunLease({ client })('q', job(), {})
    expect(info).toHaveBeenCalledWith('skipped_overlap', expect.any(Object))
    info.mockRestore()
  })

  it('rejects an unknown admission result', async () => {
    const { lease } = setup(9)
    await expect(lease('q', job(), {})).rejects.toThrow('Unknown scheduled lease admission result')
  })
})
