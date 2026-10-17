import { describe, expect, it } from 'vitest'
import {
  humanizeFieldName,
  normalizeFields,
  normalizeFieldValue,
  toDynamicConfigFieldType,
} from './fields.mts'
import { fakeConfig, fakeEntry } from './test-helpers.mts'

const entry = fakeEntry()

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
})
