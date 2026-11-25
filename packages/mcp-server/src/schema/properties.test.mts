import { describe, expect, it } from 'vitest'

import { omitSchemaProperties, pickSchemaProperties } from './properties.mts'

const ENTITY = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    name: { type: 'string' },
    internal_note: { type: 'string' },
  },
} as const

describe('pickSchemaProperties', () => {
  it('returns only the requested properties in order', () => {
    expect(pickSchemaProperties(ENTITY, ['id', 'name'])).toEqual({
      id: { type: 'string' },
      name: { type: 'string' },
    })
  })

  it('throws when a property is absent or inherited from Object.prototype', () => {
    expect(() => pickSchemaProperties(ENTITY, ['missing'])).toThrow(
      'The response contract has no "missing" property.',
    )
    expect(() => pickSchemaProperties(ENTITY, ['missing'], 'Widget')).toThrow(
      'The Widget contract has no "missing" property.',
    )
    expect(() => pickSchemaProperties(ENTITY, ['toString'], 'Widget')).toThrow(
      'The Widget contract has no "toString" property.',
    )
    expect(() => pickSchemaProperties({ type: 'object' }, ['id'])).toThrow(
      'The response contract has no "id" property.',
    )
    expect(() => pickSchemaProperties({ type: 'object', properties: [] }, ['id'])).toThrow(
      'The response contract has no "id" property.',
    )
  })

  it('rejects recursive schemas carrying $defs', () => {
    expect(() =>
      pickSchemaProperties({ ...ENTITY, $defs: { Self: { type: 'object' } } }, ['id']),
    ).toThrow('A recursive response contract cannot be nested.')
  })
})

describe('omitSchemaProperties', () => {
  it('returns every declared property except the omitted ones', () => {
    expect(omitSchemaProperties(ENTITY, ['internal_note'])).toEqual({
      id: { type: 'string' },
      name: { type: 'string' },
    })
  })

  it('rejects schemas without object properties or with recursive $defs', () => {
    expect(() => omitSchemaProperties({ type: 'object' }, ['id'])).toThrow(TypeError)
    expect(() => omitSchemaProperties({ type: 'object', properties: [] }, ['id'])).toThrow(
      TypeError,
    )
    expect(() =>
      omitSchemaProperties({ ...ENTITY, $defs: { Self: { type: 'object' } } }, ['internal_note']),
    ).toThrow('A recursive response contract cannot be nested.')
  })
})
