import { describe, expect, it } from 'vitest'

import { getOptionOutputSchema, validateOptionOutputPointers } from './option-pointers.mts'

const input = { oneOf: [{ properties: { option: { enum: ['get'] } } }] }
const twoOptions = {
  oneOf: [
    { properties: { option: { enum: ['get'] } } },
    { properties: { option: { enum: ['list'] } } },
  ],
}
const output = { type: 'object', $defs: { Value: { type: 'string' } } }
const union = {
  type: 'object',
  anyOf: [{ type: 'object', properties: { id: {} } }, { type: 'object' }],
  $defs: { Value: { type: 'string' } },
}

describe('selected output pointer publication', () => {
  it('keeps the complete root and definitions for a collapsed output', () => {
    expect(() => validateOptionOutputPointers('read', input, output, { get: '#' })).not.toThrow()
    expect(getOptionOutputSchema(output, '#')).toBe(output)
    expect(() => getOptionOutputSchema(output, '#/anyOf/0')).toThrow(
      'Invalid selected output pointer',
    )
  })

  it('selects a union branch and carries the definitions with it', () => {
    expect(
      validateOptionOutputPointers('read', twoOptions, union, {
        get: '#/anyOf/0',
        list: '#/anyOf/1',
      }),
    ).toBeUndefined()
    expect(getOptionOutputSchema(union, '#/anyOf/1')).toEqual({
      type: 'object',
      $defs: { Value: { type: 'string' } },
    })
    expect(getOptionOutputSchema({ anyOf: [{ type: 'object' }] }, '#/anyOf/0')).toEqual({
      type: 'object',
      $defs: {},
    })
  })

  it.each([
    {},
    { oneOf: [] },
    { oneOf: [{}] },
    { oneOf: [{ properties: { option: { type: 'string' } } }] },
    { oneOf: [{ properties: { option: { enum: ['get', 'list'] } } }] },
    { oneOf: [{ properties: { option: { enum: [1] } } }] },
  ])('refuses metadata without exact literal input options: %j', (schema) => {
    expect(() => validateOptionOutputPointers('read', schema, output, { get: '#' })).toThrow(
      'read: selected output pointers need literal input options',
    )
  })

  it('refuses pointers that do not cover exactly the input options', () => {
    const covers = 'must cover exactly the input options'
    const duplicate = {
      oneOf: [input.oneOf[0], input.oneOf[0]],
    }

    expect(() => validateOptionOutputPointers('read', twoOptions, union, { get: '#' })).toThrow(
      covers,
    )
    expect(() =>
      validateOptionOutputPointers('read', twoOptions, union, { get: '#', other: '#' }),
    ).toThrow(covers)
    expect(() =>
      validateOptionOutputPointers('read', duplicate, union, { get: '#', other: '#' }),
    ).toThrow(covers)
  })

  it.each(['#/anyOf/01', '#/anyOf/-1', '#/properties/x', 'anyOf/0', '#/anyOf/5'])(
    'refuses the pointer %s',
    (pointer) => {
      expect(() => validateOptionOutputPointers('read', input, union, { get: pointer })).toThrow(
        'does not resolve',
      )
      expect(() => getOptionOutputSchema(union, pointer)).toThrow('Invalid selected output pointer')
    },
  )

  it('refuses a missing output contract and non-schema targets', () => {
    expect(() => validateOptionOutputPointers('read', input, undefined, { get: '#' })).toThrow(
      'does not resolve',
    )
    expect(() =>
      validateOptionOutputPointers('read', input, { anyOf: [false] }, { get: '#/anyOf/0' }),
    ).toThrow('does not resolve')
    expect(() =>
      validateOptionOutputPointers('read', input, { anyOf: [[]] }, { get: '#/anyOf/0' }),
    ).toThrow('does not resolve')
    expect(() =>
      validateOptionOutputPointers('read', input, { anyOf: 'x' }, { get: '#/anyOf/0' }),
    ).toThrow('does not resolve')
  })
})
