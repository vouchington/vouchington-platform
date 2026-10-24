import { describe, expect, it, vi } from 'vitest'

import { SCHEDULING_FLOOR_MS, validateScheduledJobRepeat } from './repeat.mts'
import type { ScheduledJobDefinition } from './types.mts'
import { defineScheduledJobManifest, validateScheduledJobManifests } from './validation.mts'

type Job = ScheduledJobDefinition<{ id: string }>

const job = (overrides: Partial<Job> = {}): Job => ({
  schedulerId: 'daily',
  repeat: { pattern: '0 3 * * *' },
  template: { name: 'run', opts: {} },
  operatorSurfaces: [{ id: 'surface' }],
  ...overrides,
})

const validate = (jobs: Job[], queueName = 'queue') =>
  validateScheduledJobManifests([{ queueName, jobs }])

describe('validateScheduledJobManifests', () => {
  it('accepts a valid manifest and returns it from defineScheduledJobManifest', () => {
    const jobs = [job()]

    expect(() => validate(jobs)).not.toThrow()
    expect(defineScheduledJobManifest('queue', jobs)).toEqual({ queueName: 'queue', jobs })
  })

  it.each([
    ['empty queue name', () => validate([job()], ''), 'queueName must be a nonempty string'],
    ['padded queue name', () => validate([job()], ' q'), 'queueName must not have surrounding'],
    [
      'non-string scheduler id',
      () => validate([job({ schedulerId: 1 as never })]),
      'must be a string',
    ],
    [
      'empty scheduler id',
      () => validate([job({ schedulerId: ' ' })]),
      'schedulerId must be a nonempty',
    ],
    [
      'empty job name',
      () => validate([job({ template: { name: '', opts: {} } })]),
      'job name must be a nonempty',
    ],
  ])('rejects %s', (_label, fn, message) => {
    expect(fn).toThrow(message)
  })

  it('rejects duplicate scheduler keys, within and across manifests', () => {
    expect(() => validate([job(), job()])).toThrow('Duplicate scheduled job: queue/daily')
    expect(() =>
      validateScheduledJobManifests([
        { queueName: 'q', jobs: [job()] },
        { queueName: 'q', jobs: [job()] },
      ]),
    ).toThrow('Duplicate scheduled job: q/daily')
    expect(() =>
      validateScheduledJobManifests([
        { queueName: 'a', jobs: [job()] },
        { queueName: 'b', jobs: [job()] },
      ]),
    ).not.toThrow()
  })

  it('rejects data with dataFactory and a non-function dataFactory', () => {
    const base = { name: 'run', opts: {} }
    expect(() =>
      validate([job({ template: { ...base, data: 1, dataFactory: () => 2 } as never })]),
    ).toThrow('cannot define data and dataFactory')
    expect(() => validate([job({ template: { ...base, dataFactory: 1 } as never })])).toThrow(
      'dataFactory must be a function',
    )
    expect(() => validate([job({ template: { ...base, dataFactory: () => 2 } })])).not.toThrow()
  })

  it('validates non-thunk repeats now and skips thunks until registration', () => {
    expect(() => validate([job({ repeat: { every: 10 } })])).toThrow('below the 60000ms')
    expect(() => validate([job({ repeat: () => ({ every: 10 }) })])).not.toThrow()
    expect(() =>
      validate([job({ repeat: { every: 10 }, subMinuteJustification: 'needs it' })]),
    ).not.toThrow()
  })

  it('requires operator surfaces and calls validateSurface for each with the scheduler key', () => {
    expect(() => validate([job({ operatorSurfaces: [] as never })])).toThrow(
      'queue/daily must define an operator surface',
    )
    const validateSurface = vi.fn()
    const surfaces: [{ id: string }, ...{ id: string }[]] = [{ id: 'a' }, { id: 'b' }]

    validateScheduledJobManifests(
      [{ queueName: 'q', jobs: [job({ operatorSurfaces: surfaces })] }],
      {
        validateSurface,
      },
    )

    expect(validateSurface).toHaveBeenNthCalledWith(1, { id: 'a' }, 'q/daily')
    expect(validateSurface).toHaveBeenNthCalledWith(2, { id: 'b' }, 'q/daily')
  })

  it('propagates validateSurface failures through defineScheduledJobManifest', () => {
    expect(() =>
      defineScheduledJobManifest('q', [job()], {
        validateSurface: () => {
          throw new Error('bad surface')
        },
      }),
    ).toThrow('bad surface')
  })
})

describe('validateScheduledJobRepeat', () => {
  it('accepts 5-field cron patterns and every at or above the floor', () => {
    expect(() => validateScheduledJobRepeat({ pattern: '*/5  * * * *' }, 'k')).not.toThrow()
    expect(() => validateScheduledJobRepeat({ every: SCHEDULING_FLOOR_MS }, 'k')).not.toThrow()
  })

  it('requires exactly one of pattern and every', () => {
    expect(() => validateScheduledJobRepeat({} as never, 'k')).toThrow('exactly one of')
    expect(() =>
      validateScheduledJobRepeat({ pattern: '* * * * *', every: 60_000 } as never, 'k'),
    ).toThrow('exactly one of')
  })

  it.each([
    [{ pattern: '' }, 'repeat pattern must be a nonempty'],
    [{ pattern: ' * * * * *' }, 'must not have surrounding whitespace'],
    [{ pattern: '* * * *' }, '5-field cron pattern (got 4 fields)'],
    [{ pattern: '* * * * * *' }, '(got 6 fields)'],
  ])('rejects pattern %j', (repeat, message) => {
    expect(() => validateScheduledJobRepeat(repeat, 'k')).toThrow(message)
  })

  it.each([0, -1, Number.NaN, Number.POSITIVE_INFINITY])('rejects every %s', (every) => {
    expect(() => validateScheduledJobRepeat({ every }, 'k')).toThrow('positive finite')
  })

  it('applies the sub-minute floor unless justified', () => {
    expect(() => validateScheduledJobRepeat({ every: 59_999 }, 'k')).toThrow('below the 60000ms')
    expect(() => validateScheduledJobRepeat({ every: 1 }, 'k', '  ')).toThrow('below the')
    expect(() => validateScheduledJobRepeat({ every: 1 }, 'k', 'poll')).not.toThrow()
  })
})
