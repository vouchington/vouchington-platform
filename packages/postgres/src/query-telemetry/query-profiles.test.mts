import { describe, expect, it, vi } from 'vitest'
import { createQueryProfiles } from './query-profiles.mts'
import { createQueryTimingRecorder } from './timing-recorder.mts'
import { computeSerialDepth, summarizeRequestQueries, type RequestQuery } from './query-summary.mts'

function query(annotation: string | null, startMs: number, endMs: number, excluded = false) {
  return { annotation, startMs, endMs, excludedFromRepeats: excluded } satisfies RequestQuery
}

const timing = { pool: 'read', durationMs: 0, rowCount: 0, error: false } as const

function recorderFor(profiles: ReturnType<typeof createQueryProfiles>) {
  return createQueryTimingRecorder({
    observe: profiles.observe,
    enabled: () => false,
    emit: () => undefined,
  })
}

describe('query summary math', () => {
  it('counts sequential queries as depth and overlapping ones once', () => {
    expect(computeSerialDepth([query('a', 0, 5), query('b', 5, 10), query('c', 10, 12)])).toBe(3)
    expect(computeSerialDepth([query('a', 0, 10), query('b', 1, 9), query('c', 2, 8)])).toBe(1)
    expect(computeSerialDepth([query('a', 0, 5), query('b', 4, 9), query('c', 8, 12)])).toBe(2)
    expect(computeSerialDepth([])).toBe(0)
  })

  it('reports repeated annotations and skips excluded queries', () => {
    const queries = [
      query('loadPost', 0, 1),
      query('loadPost', 1, 2),
      query('loadPost', 2, 3),
      query('list', 3, 4),
      query('batched', 4, 5, true),
      query('batched', 5, 6, true),
      query(null, 6, 7),
      query(null, 7, 8),
      query('aaa', 8, 9),
      query('aaa', 9, 10),
    ]
    expect(summarizeRequestQueries(queries)).toEqual({
      totalQueries: 10,
      serialDepth: 10,
      repeats: [
        { annotation: 'loadPost', count: 3 },
        { annotation: 'aaa', count: 2 },
        { annotation: 'unannotated', count: 2 },
      ],
    })
  })
})

describe('request query profile attribution', () => {
  it('attributes timing-hook queries to the active scope only', async () => {
    const profiles = createQueryProfiles()
    const record = recorderFor(profiles)
    const first = profiles.createRequestQueryProfile()
    const second = profiles.createRequestQueryProfile()
    record({ ...timing, annotation: 'outside' })
    await Promise.all([
      first.run(async () => {
        await Promise.resolve()
        record({ ...timing, annotation: 'one' })
        record({ ...timing, annotation: 'one', cursorBatches: 3 })
        record({ ...timing, annotation: 'one', pipelined: true })
      }),
      second.run(async () => {
        await Promise.resolve()
        record({ ...timing, annotation: 'two' })
      }),
    ])
    expect(first.summarize().totalQueries).toBe(3)
    expect(first.summarize().repeats).toEqual([])
    expect(second.summarize().totalQueries).toBe(1)
  })

  it('ignores package transaction control but flags statements repeated inside them', () => {
    const profiles = createQueryProfiles()
    const record = recorderFor(profiles)
    const profile = profiles.createRequestQueryProfile()
    profile.run(() => {
      for (let i = 0; i < 2; i++) {
        record({ ...timing, annotation: 'beginTransaction' })
        record({ ...timing, annotation: 'beginBoundedTransaction' })
        record({ ...timing, annotation: 'withClientTransaction' })
        record({ ...timing, annotation: 'insideTransaction' })
        record({ ...timing, annotation: null })
      }
    })
    const summary = profile.summarize()
    expect(summary.totalQueries).toBe(10)
    expect(summary.repeats).toEqual([
      { annotation: 'insideTransaction', count: 2 },
      { annotation: 'unannotated', count: 2 },
    ])
  })

  it('adds caller exclusions to the defaults', () => {
    const profiles = createQueryProfiles({ excludedFromRepeats: ['custom'] })
    const profile = profiles.createRequestQueryProfile()
    profile.run(() => {
      for (let i = 0; i < 2; i++) {
        profiles.observe({ ...timing, annotation: 'custom' })
        profiles.observe({ ...timing, annotation: 'beginTransaction' })
      }
    })
    expect(profile.summarize().repeats).toEqual([])
  })

  it('records start and end from the reported duration', () => {
    const profiles = createQueryProfiles()
    const profile = profiles.createRequestQueryProfile()
    profile.run(() => profiles.observe({ annotation: 'timed', durationMs: 5 }))
    const worker = profiles.runIndependentWorker(
      { queue: 'q', jobs: [{ id: '1', name: 'n' }] },
      () => profiles.observe({ annotation: 'timed', durationMs: 5 }),
    )
    return worker.completion.then(() => {
      const [recorded] = worker.profile.queries()
      expect(recorded!.endMs - recorded!.startMs).toBeCloseTo(5)
    })
  })

  it('shares scopes across module graphs through the default registry key', async () => {
    const profile = createQueryProfiles().createRequestQueryProfile()
    vi.resetModules()
    const fresh = await import('./query-profiles.mts')
    profile.run(() =>
      fresh.createQueryProfiles().observe({ annotation: 'afterReset', durationMs: 0 }),
    )
    expect(profile.summarize().totalQueries).toBe(1)
  })

  it('isolates profiles that use different registry keys', () => {
    const profile = createQueryProfiles({
      registryKey: Symbol.for('test.queryProfiles.a'),
    }).createRequestQueryProfile()
    const other = createQueryProfiles({ registryKey: Symbol.for('test.queryProfiles.b') })
    profile.run(() => other.observe({ annotation: 'elsewhere', durationMs: 0 }))
    expect(profile.summarize().totalQueries).toBe(0)
  })
})
