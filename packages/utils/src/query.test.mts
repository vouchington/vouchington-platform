import { describe, expect, it } from 'vitest'
import {
  parseBooleanish,
  parseBoundedInteger,
  parseNumberParam,
  parseNumberParams,
  parseStringArray,
} from './query.mts'

describe('query primitives', () => {
  it('parses arrays, booleans, and numbers without cursor semantics', () => {
    expect(parseStringArray([' a ', 2])).toEqual([' a ', '2'])
    expect(parseStringArray('a, , b')).toEqual(['a', 'b'])
    expect(parseStringArray(null)).toEqual([])
    expect(parseBooleanish(true)).toBe(true)
    expect(parseBooleanish('TRUE')).toBe(true)
    expect(parseBooleanish(2)).toBe(true)
    expect(parseBooleanish('false')).toBe(false)
    expect(parseNumberParam({ a: '2' }, 'a')).toBe(2)
    expect(parseNumberParam({}, 'a')).toBeUndefined()
    expect(parseNumberParam({ a: 'no' }, 'a')).toBeUndefined()
    expect(parseNumberParams({ a: '2', b: 'no' }, ['a', 'b'])).toEqual({ a: 2 })
  })
  it('requires canonical integers within caller-provided bounds', () => {
    expect(parseBoundedInteger(undefined, { default: 10, minimum: 1, maximum: 20 })).toBe(10)
    expect(parseBoundedInteger('12', { default: 10, minimum: 1, maximum: 20 })).toBe(12)
    expect(() => parseBoundedInteger('12px', { default: 10, minimum: 1, maximum: 20 })).toThrow(
      'integer',
    )
    expect(parseBoundedInteger(null, { default: 10, minimum: 1, maximum: 20 })).toBe(10)
    expect(() => parseBoundedInteger({}, { default: 10, minimum: 1, maximum: 20 })).toThrow(
      'integer',
    )
    expect(() =>
      parseBoundedInteger(String(Number.MAX_SAFE_INTEGER + 1), {
        default: 10,
        minimum: 1,
        maximum: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow('safe')
    expect(() => parseBoundedInteger(0, { default: 10, minimum: 1, maximum: 20 })).toThrow(
      'between',
    )
    expect(() => parseBoundedInteger('2', { default: 0, minimum: 3, maximum: 2 })).toThrow('bounds')
  })
})
