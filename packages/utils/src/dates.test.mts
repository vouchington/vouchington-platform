import { describe, expect, it } from 'vitest'
import {
  enumerateUtcDaysInclusive,
  getCurrentUtcDay,
  getDayBounds,
  getPreviousUtcDays,
  getUtcDayFromDate,
  parseDuration,
  parseUtcDay,
} from './dates.mts'

describe('dates', () => {
  it('works with UTC days', () => {
    expect(getUtcDayFromDate(new Date('2026-02-03T23:00:00-08:00'))).toBe('2026-02-04')
    expect(getCurrentUtcDay()).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(enumerateUtcDaysInclusive('2026-02-03', '2026-02-05')).toEqual([
      '2026-02-03',
      '2026-02-04',
      '2026-02-05',
    ])
    expect(enumerateUtcDaysInclusive('2026-02-05', '2026-02-03')).toEqual([])
    expect(
      getPreviousUtcDays(2, { includeToday: false, baseDate: new Date('2026-02-03T12:00:00Z') }),
    ).toEqual(['2026-02-02', '2026-02-01'])
    expect(getPreviousUtcDays(0)).toEqual([])
    expect(getPreviousUtcDays(1)).toHaveLength(1)
    expect(getPreviousUtcDays(1, { baseDate: new Date('2026-02-03T12:00:00Z') })).toEqual([
      '2026-02-03',
    ])
    expect(getDayBounds('2026-02-03')).toEqual({
      startMs: Date.parse('2026-02-03T00:00:00Z'),
      endMs: Date.parse('2026-02-04T00:00:00Z'),
    })
    expect(parseUtcDay('2026-02-03')).toEqual({ year: '2026', month: '02', day: '03' })
    expect(() => parseUtcDay('2026-02-30')).toThrow('Invalid UTC day')
  })

  it.each([
    [90, 90],
    ['01:30', 90],
    ['1:02:03', 3723],
    ['9', 9],
    ['  ', null],
    [-1, null],
    ['one', null],
    ['1:2:3:4', null],
    [Number.NaN, null],
  ])('parses duration %#', (input, expected) => {
    expect(parseDuration(input)).toBe(expected)
  })

  it('rejects unparseable UTC dates', () => {
    expect(() => getDayBounds('not-a-day')).toThrow('Invalid UTC day')
  })
})
