import { describe, expect, it } from 'vitest'
import {
  assertPlainChanges,
  getChangedFields,
  humanizeFieldName,
  normalizeFields,
  normalizeFieldValue,
  toDynamicConfigFieldType,
  validateChanges,
} from './fields.mts'
import { fakeConfig, fakeEntry } from './test-helpers.mts'

const entry = fakeEntry()
const previous = { enabled: false, limit: 5, mode: 'a' }

describe('assertPlainChanges', () => {
  it('rejects non-objects, arrays, and empty objects', () => {
    expect(() => assertPlainChanges(null as never)).toThrow('Missing config object')
    expect(() => assertPlainChanges([] as never)).toThrow('Missing config object')
    expect(() => assertPlainChanges({})).toThrow('must not be empty')
    expect(() => assertPlainChanges({ a: 1 })).not.toThrow()
  })
})

describe('validateChanges', () => {
  it('accepts valid values', () => {
    expect(validateChanges(entry, previous, { enabled: true, limit: 3, mode: 'z' })).toEqual({
      enabled: true,
      limit: 3,
      mode: 'z',
    })
  })

  it.each([
    [{ nope: 1 }, 'Unknown config field: nope'],
    [{ toString: 1 }, 'Unknown config field: toString'],
    [{ enabled: 'x' }, 'Field enabled must be a boolean'],
    [{ mode: 1 }, 'Field mode must be a string'],
    [{ limit: Number.NaN }, 'finite number'],
    [{ limit: '3' }, 'finite number'],
    [{ limit: 2.5 }, 'safe integer'],
    [{ limit: 0 }, 'greater than or equal to 1'],
    [{ limit: 11 }, 'less than or equal to 10'],
  ])('rejects %j', (changes, message) => {
    expect(() => validateChanges(entry, previous, changes)).toThrow(message)
  })

  it('rejects a declared field missing from the previous snapshot', () => {
    expect(() => validateChanges(entry, { enabled: false }, { limit: 2 })).toThrow('Unknown')
  })

  it('applies no bounds without metadata', () => {
    const bare = fakeEntry({ fields: { enabled: {}, limit: {}, mode: {} } })
    expect(validateChanges(bare, previous, { limit: -1.5 })).toEqual({ limit: -1.5 })
    const noMeta = { ...entry, fields: {} }
    expect(validateChanges(noMeta, previous, { limit: 1e9 })).toEqual({ limit: 1e9 })
  })
})

describe('normalizeFields', () => {
  it('falls back to defaults and validates types', () => {
    expect(normalizeFields(entry, { limit: 9 })).toEqual({ enabled: false, limit: 9, mode: 'a' })
    expect(() => normalizeFields(entry, { limit: 'x' })).toThrow(
      'Invalid number config field limit',
    )
    expect(() => normalizeFields(entry, { mode: 3 })).toThrow('Invalid string config field mode')
  })

  it('rejects unsupported field types', () => {
    const bad = fakeEntry({ fields: { x: {} } }, fakeConfig({ x: 'date' as never }, { x: 'y' }))
    expect(() => normalizeFields(bad, {})).toThrow('Unsupported dynamic config field type for x')
    expect(() => toDynamicConfigFieldType('x', 'boolean')).not.toThrow()
    expect(normalizeFieldValue('x', 'boolean', true)).toBe(true)
  })
})

describe('helpers', () => {
  it('humanizes names', () => {
    expect(humanizeFieldName('a_b_c')).toBe('a b c')
  })

  it('diffs field snapshots', () => {
    expect(getChangedFields({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 })).toEqual({
      b: { previous: 2, next: 3 },
      c: { previous: undefined, next: 4 },
    })
    expect(getChangedFields(null, undefined)).toEqual({})
  })
})
