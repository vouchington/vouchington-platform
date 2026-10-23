import { describe, expect, it } from 'vitest'
import { createQueryProfiles } from './query-profiles.mts'

const profiles = createQueryProfiles()
const { observe, createRequestQueryProfile, runIndependentWorker } = profiles
const timing = { durationMs: 0 }
const record = (annotation: string) => observe({ ...timing, annotation })
const identity = (id: string) => ({ queue: 'profile-contract', jobs: [{ id, name: 'owned' }] })

describe('independent worker query profiles', () => {
  it('keeps request repeats separate from repeated worker queries', async () => {
    const request = createRequestQueryProfile()
    const result = await request.run(async () => {
      record('genuineRequestRepeat')
      const worker = runIndependentWorker(identity('first'), () => {
        record('workerRepeat')
        record('workerRepeat')
        return 'unchanged business result'
      })
      expect(await worker.completion).toBe('unchanged business result')
      record('genuineRequestRepeat')
      return worker
    })
    expect(request.summarize().totalQueries).toBe(2)
    expect(request.summarize().repeats).toEqual([{ annotation: 'genuineRequestRepeat', count: 2 }])
    expect(result.profile.queries()).toHaveLength(2)
    expect(result.profile.summarize().repeats).toEqual([{ annotation: 'workerRepeat', count: 2 }])
    expect(request.workerProfiles()).toEqual([result.profile])
  })

  it('retains worker timings without an active request', async () => {
    const worker = runIndependentWorker(identity('outside'), async () => {
      await Promise.resolve()
      record('outsideRequest')
      return 17
    })
    expect(await worker.completion).toBe(17)
    expect(worker.profile.queries()).toEqual([
      expect.objectContaining({ annotation: 'outsideRequest' }),
    ])
    expect(worker.profile.identity).toEqual(identity('outside'))
  })

  it('keeps concurrently started jobs in distinct buckets', async () => {
    const request = createRequestQueryProfile()
    const workers = request.run(() =>
      ['first', 'second'].map((id) =>
        runIndependentWorker(identity(id), async () => {
          await Promise.resolve()
          record(id)
        }),
      ),
    )
    await Promise.all(workers.map((worker) => worker.completion))
    expect(request.summarize().totalQueries).toBe(0)
    expect(
      request.workerProfiles().map((worker) => worker.queries().map((query) => query.annotation)),
    ).toEqual([['first'], ['second']])
  })

  it('attributes nested jobs independently and restores the parent worker scope', async () => {
    const request = createRequestQueryProfile()
    const parent = request.run(() =>
      runIndependentWorker(identity('parent'), async () => {
        record('parentBefore')
        const child = runIndependentWorker(identity('child'), () => {
          record('child')
        })
        await child.completion
        record('parentAfter')
      }),
    )
    await parent.completion
    expect(request.summarize().totalQueries).toBe(0)
    expect(request.workerProfiles()).toEqual([parent.profile])
    expect(parent.profile.queries().map((query) => query.annotation)).toEqual([
      'parentBefore',
      'parentAfter',
    ])
    expect(
      parent.profile
        .workerProfiles()
        .map((worker) => worker.queries().map((query) => query.annotation)),
    ).toEqual([['child']])
  })

  it('preserves an undefined rejection and its already completed query', async () => {
    const request = createRequestQueryProfile()
    const worker = request.run(() =>
      runIndependentWorker(identity('rejected'), () => {
        record('beforeFailure')
        return new Promise<never>((_resolve, reject) => {
          // oxlint-disable-next-line typescript/prefer-promise-reject-errors -- Verify exact passthrough of an undefined worker rejection.
          reject()
        })
      }),
    )
    await expect(worker.completion).rejects.toBeUndefined()
    expect(worker.profile.summarize().totalQueries).toBe(1)
    expect(request.summarize().totalQueries).toBe(0)
  })

  it('records owner callback and reporting failures without rethrowing', async () => {
    const boom = new Error('owner failed')
    const worker = runIndependentWorker(
      identity('owner'),
      () => 1,
      () => {
        throw boom
      },
    )
    expect(await worker.completion).toBe(1)
    worker.profile.reportFailure('later', 'reason')
    expect(worker.profile.reportingFailures()).toEqual([
      { stage: 'profile-owner', reason: boom },
      { stage: 'later', reason: 'reason' },
    ])
  })

  it('hands the owned profile to the owner callback synchronously', () => {
    let owned: unknown
    const worker = runIndependentWorker(
      identity('sync'),
      () => 1,
      (profile) => {
        owned = profile
      },
    )
    expect(owned).toBe(worker.profile)
  })

  it.each([
    { queue: '', jobs: [{ id: '1', name: 'n' }] },
    { queue: 'q', jobs: [] },
    { queue: 'q', jobs: [{ id: '', name: 'n' }] },
    { queue: 'q', jobs: [{ id: '1', name: '' }] },
    { queue: 'q', jobs: [{ id: 1, name: 'n' }] },
    { queue: 'q', jobs: [{ id: '1', name: 2 }] },
  ])('rejects absent physical identities before starting effects: %j', (bad) => {
    let started = false
    expect(() =>
      runIndependentWorker(bad as never, () => {
        started = true
      }),
    ).toThrow('actual queue/job identities')
    expect(started).toBe(false)
  })
})
