import { describe, expect, it, vi } from 'vitest'

import type { QueryTimingInput } from '../types.mts'
import { createQueryTimingRecorder, parseQueryTimingSampleRate } from './timing-recorder.mts'

const input: QueryTimingInput = {
  annotation: 'listUsers',
  pool: 'read',
  durationMs: 12,
  rowCount: 3,
  error: false,
}
const at = new Date('2026-03-04T05:06:07.000Z')

describe('createQueryTimingRecorder', () => {
  it('emits a snake_case record, omitting unset optional fields', () => {
    const emit = vi.fn()
    createQueryTimingRecorder({ emit, env: { NODE_ENV: 'production' }, now: () => at })(input)
    expect(emit).toHaveBeenCalledWith({
      event_id: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      event_time: at,
      event_date: '2026-03-04',
      env: 'production',
      annotation: 'listUsers',
      pool: 'read',
      duration_ms: 12,
      row_count: 3,
      error: false,
    })
  })

  it('includes cursor, pipeline and batch details and defaults labels', () => {
    const emit = vi.fn()
    createQueryTimingRecorder({ emit, env: {} })({
      ...input,
      annotation: null,
      cursorBatches: 2,
      pipelined: true,
      batchSize: 5,
    })
    expect(emit).toHaveBeenCalledWith(
      expect.objectContaining({
        annotation: 'unannotated',
        env: 'development',
        cursor_batches: 2,
        pipelined: true,
        batch_size: 5,
        event_time: expect.any(Date),
      }),
    )
  })

  it('observes every query even when disabled or unsampled', () => {
    const emit = vi.fn()
    const observe = vi.fn()
    createQueryTimingRecorder({ emit, observe, enabled: () => false, env: {} })(input)
    createQueryTimingRecorder({ emit, observe, sampleRate: 0, env: {} })(input)
    expect(observe).toHaveBeenCalledTimes(2)
    expect(emit).not.toHaveBeenCalled()
  })

  it('samples by rate, reading function rates per query', () => {
    const emit = vi.fn()
    const random = vi.fn().mockReturnValueOnce(0.2).mockReturnValueOnce(0.8)
    const record = createQueryTimingRecorder({ emit, sampleRate: () => 0.5, random, env: {} })
    record(input)
    record(input)
    expect(emit).toHaveBeenCalledOnce()
    const everything = vi.fn()
    createQueryTimingRecorder({ emit: everything, sampleRate: Number.NaN, env: {} })(input)
    createQueryTimingRecorder({ emit: everything, sampleRate: 1, env: {} })(input)
    expect(everything).toHaveBeenCalledTimes(2)
  })

  it('names slow errored queries only in test environments', () => {
    const writeStderr = vi.fn()
    const failed = { ...input, error: true, durationMs: 501 }
    const emit = vi.fn()
    const test = createQueryTimingRecorder({ emit, writeStderr, env: { NODE_ENV: 'test' } })
    test(failed)
    test({ ...failed, annotation: null })
    test({ ...failed, durationMs: 500 })
    test({ ...failed, error: false })
    createQueryTimingRecorder({ emit, writeStderr, env: { VITEST: 'true' } })(failed)
    createQueryTimingRecorder({ emit, writeStderr, env: {} })(failed)
    expect(writeStderr.mock.calls).toEqual([
      ['[pg-query-failed] annotation=listUsers pool=read ms=501\n'],
      ['[pg-query-failed] annotation=unannotated pool=read ms=501\n'],
      ['[pg-query-failed] annotation=listUsers pool=read ms=501\n'],
    ])
  })

  it('honors a custom threshold and defaults stderr and env', () => {
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true)
    createQueryTimingRecorder({ emit: vi.fn(), slowFailureThresholdMs: 1 })({
      ...input,
      error: true,
      durationMs: 2,
    })
    expect(write).toHaveBeenCalledWith('[pg-query-failed] annotation=listUsers pool=read ms=2\n')
    write.mockRestore()
  })
})

describe('parseQueryTimingSampleRate', () => {
  it.each([
    [undefined, 1],
    ['', 1],
    ['abc', 1],
    ['0.25', 0.25],
    ['0', 0],
  ])('parses %s', (raw, expected) => {
    expect(parseQueryTimingSampleRate(raw)).toBe(expected)
  })
})
