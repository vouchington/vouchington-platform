import { describe, expect, it } from 'vitest'
import { alignedScheduleText, clampScheduledJobRepeatToHourlyFloor } from './hourly-clamp.mts'

const HOUR = 60 * 60_000
const HOURLY_PATTERN = '0 * * * *'
const DAY = 24 * HOUR

describe('clampScheduledJobRepeatToHourlyFloor', () => {
  describe('every-type repeat', () => {
    it.each([
      ['5 seconds', 5_000],
      ['1 minute', 60_000],
      ['5 minutes', 300_000],
      ['59 minutes', 59 * 60_000],
      ['exactly 1 hour', HOUR],
    ])('aligns every %s to the top of the hour', (_label, every) => {
      expect(clampScheduledJobRepeatToHourlyFloor({ every })).toEqual({
        repeat: { pattern: HOURLY_PATTERN },
        clamped: true,
      })
    })

    it.each([
      ['2 hours', 2 * HOUR, '0 */2 * * *'],
      ['3 hours', 3 * HOUR, '0 */3 * * *'],
      ['4 hours', 4 * HOUR, '0 */4 * * *'],
      ['6 hours', 6 * HOUR, '0 */6 * * *'],
      ['8 hours', 8 * HOUR, '0 */8 * * *'],
      ['12 hours', 12 * HOUR, '0 */12 * * *'],
      ['24 hours', DAY, '0 0 * * *'],
    ])(
      'aligns every %s, which divides 24h, to the matching hour-step cron',
      (_l, every, pattern) => {
        expect(clampScheduledJobRepeatToHourlyFloor({ every })).toEqual({
          repeat: { pattern },
          clamped: true,
        })
      },
    )

    it.each([
      ['90 minutes', 1.5 * HOUR, '0 */2 * * *'],
      ['2 hours 1 minute', 2 * HOUR + 60_000, '0 */3 * * *'],
      ['5 hours', 5 * HOUR, '0 */6 * * *'],
      ['7 hours', 7 * HOUR, '0 */8 * * *'],
      ['9 hours', 9 * HOUR, '0 */12 * * *'],
      ['13 hours', 13 * HOUR, '0 0 * * *'],
    ])('rounds every %s up to the next hour-step cron that is no more frequent', (_l, every, p) => {
      expect(clampScheduledJobRepeatToHourlyFloor({ every })).toEqual({
        repeat: { pattern: p },
        clamped: true,
      })
    })

    it.each([
      ['24 hours 1 minute', DAY + 60_000, '0 0 * * 0'],
      ['3 days', 3 * DAY, '0 0 * * 0'],
      ['7 days', 7 * DAY, '0 0 * * 0'],
      ['8 days', 8 * DAY, '0 0 1 * *'],
      ['90 days', 90 * DAY, '0 0 1 * *'],
    ])('rounds every %s up to a weekly or monthly cron', (_label, every, pattern) => {
      expect(clampScheduledJobRepeatToHourlyFloor({ every })).toEqual({
        repeat: { pattern },
        clamped: true,
      })
    })
  })

  describe('pattern-type repeat', () => {
    it.each([
      ['* * * * *', '0 * * * *'],
      ['*/5 * * * *', '0 * * * *'],
      ['*/15 * * * *', '0 * * * *'],
      ['*/30 * * * *', '0 * * * *'],
      ['0,30 * * * *', '0 * * * *'],
      ['10-20 * * * *', '0 * * * *'],
      ['17 * * * *', '0 * * * *'],
    ])('rewrites hourly-or-faster pattern %s to %s', (pattern, expected) => {
      expect(clampScheduledJobRepeatToHourlyFloor({ pattern })).toEqual({
        repeat: { pattern: expected },
        clamped: true,
      })
    })

    it.each([
      ['30 2 * * *', '0 2 * * *'],
      ['5 4 1 * *', '0 4 1 * *'],
      ['45 9 * * 1', '0 9 * * 1'],
      ['*/10 9-17 * * 1-5', '0 9-17 * * 1-5'],
      ['  15   3 * 6 *  ', '0 3 * 6 *'],
    ])('keeps the other fields and moves the minute of %s to :00', (pattern, expected) => {
      expect(clampScheduledJobRepeatToHourlyFloor({ pattern })).toEqual({
        repeat: { pattern: expected },
        clamped: true,
      })
    })

    it.each(['0 * * * *', '0 2 * * *', '0 3 * * 0', '0 4 * * 1', '0 9 * * 1', '0 0 1 * *'])(
      'leaves already-aligned pattern %s untouched, same reference',
      (pattern) => {
        const repeat = { pattern }
        const result = clampScheduledJobRepeatToHourlyFloor(repeat)
        expect(result).toEqual({ repeat, clamped: false })
        expect(result.repeat).toBe(repeat)
      },
    )

    it.each(['5/10 * * * *', '0-30/10 * * * *', '59 * * * *', '1,2,3 * * * *', '*/59 * * * *'])(
      'accepts the valid minute field of %s',
      (pattern) => {
        expect(clampScheduledJobRepeatToHourlyFloor({ pattern }).repeat).toEqual({
          pattern: HOURLY_PATTERN,
        })
      },
    )

    it.each([
      'a * * * *',
      '60 * * * *',
      '61 * * * *',
      '*/0 * * * *',
      '*/ * * * *',
      '30-10 * * * *',
      '5-70 * * * *',
      '1/2/3 * * * *',
      '5-10-15 * * * *',
      '1,,2 * * * *',
      '-5 * * * *',
    ])('rejects the invalid minute field of %s instead of rewriting it', (pattern) => {
      expect(() => clampScheduledJobRepeatToHourlyFloor({ pattern })).toThrow(
        'Invalid cron minute field',
      )
    })

    it.each(['', '* * * *', '* * * * * *'])('rejects the non-5-field pattern %j', (pattern) => {
      expect(() => clampScheduledJobRepeatToHourlyFloor({ pattern })).toThrow(
        'Expected a 5-field cron pattern',
      )
    })
  })
})

describe('alignedScheduleText', () => {
  it.each([
    ['0 * * * *', 'every 1h'],
    ['0 */3 * * *', 'every 3h'],
    ['0 */12 * * *', 'every 12h'],
    ['0 2 * * *', '0 2 * * *'],
    ['0 0 * * 0', '0 0 * * 0'],
  ])('describes %s as %s', (pattern, expected) => {
    expect(alignedScheduleText(pattern)).toBe(expected)
  })
})
