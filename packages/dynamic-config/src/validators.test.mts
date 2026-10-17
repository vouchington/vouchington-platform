import { describe, expect, it } from 'vitest'
import { DynamicConfigValidationError } from './errors.mts'
import {
  validateNumberRange,
  validateOneOf,
  validatePositiveIntegerFields,
  validatePositiveNumberFields,
  validateStrictlyAscending,
} from './validators.mts'

describe('validators', () => {
  it('requires positive finite numbers and ignores other types', () => {
    expect(() => validatePositiveNumberFields({ a: 1.5, b: 'x', c: true })).not.toThrow()
    expect(() => validatePositiveNumberFields({ a: 0 })).toThrow(DynamicConfigValidationError)
    expect(() => validatePositiveNumberFields({ a: Infinity })).toThrow('positive finite number')
  })

  it('requires positive integers', () => {
    expect(() => validatePositiveIntegerFields({ a: 2, b: 'x' })).not.toThrow()
    expect(() => validatePositiveIntegerFields({ a: 1.5 })).toThrow('positive integer')
    expect(() => validatePositiveIntegerFields({ a: 0 })).toThrow('positive integer')
  })

  it('checks inclusive ranges', () => {
    expect(() => validateNumberRange({ a: 0 }, 'a', 0, 1)).not.toThrow()
    expect(() => validateNumberRange({ a: 1 }, 'a', 0, 1)).not.toThrow()
    expect(() => validateNumberRange({ a: 2 }, 'a', 0, 1)).toThrow('between 0 and 1')
    expect(() => validateNumberRange({ a: -1 }, 'a', 0, 1)).toThrow('between 0 and 1')
    expect(() => validateNumberRange({ a: 'x' }, 'a', 0, 1)).toThrow('between 0 and 1')
    expect(() => validateNumberRange({ a: Number.NaN }, 'a', 0, 1)).toThrow('between 0 and 1')
  })

  it('checks enumerated strings', () => {
    expect(() => validateOneOf({ m: 'on' }, 'm', ['on', 'off'])).not.toThrow()
    expect(() => validateOneOf({ m: 'x' }, 'm', ['on', 'off'])).toThrow('m: must be on|off')
    expect(() => validateOneOf({ m: 1 }, 'm', ['on'])).toThrow('must be on')
  })

  it('checks strict ordering', () => {
    expect(() => validateStrictlyAscending({ a: 1, b: 2, c: 3 }, ['a', 'b', 'c'])).not.toThrow()
    expect(() => validateStrictlyAscending({ a: 1, b: 1 }, ['a', 'b'])).toThrow('a < b')
    expect(() => validateStrictlyAscending({ a: 1 }, ['a'])).not.toThrow()
  })
})
