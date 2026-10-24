import { describe, expect, it } from 'vitest'

import { pruneToSchema } from './prune.mts'

const user = {
  type: 'object',
  properties: { id: { type: 'string' }, roles: { type: 'array', items: { type: 'string' } } },
}
const schema = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    created_by: { anyOf: [user, { type: 'null' }] },
    tags: { anyOf: [{ type: 'array', items: user }, { type: 'null' }] },
    note: { type: 'string' },
    extra_map: { type: 'object' },
  },
}

describe('pruneToSchema', () => {
  it('drops properties the schema does not declare, at every depth', () => {
    expect(
      pruneToSchema(schema, {
        id: 'p1',
        internal_flag: true,
        created_by: { id: 'u1', roles: ['a'], display_account: 'x' },
        tags: [{ id: 't1', hidden: 1 }, { id: 't2' }],
      }),
    ).toEqual({
      id: 'p1',
      created_by: { id: 'u1', roles: ['a'] },
      tags: [{ id: 't1' }, { id: 't2' }],
    })
  })

  it('keeps null, primitives and values the schema does not describe', () => {
    const value = { id: 'p1', created_by: null, tags: null, note: 'n', extra_map: { anything: 1 } }

    expect(pruneToSchema(schema, value)).toEqual(value)
    expect(pruneToSchema(schema, ['kept'])).toEqual(['kept'])
    expect(pruneToSchema(schema, 'text')).toBe('text')
  })

  it('prunes a property declared by several branches against every declaration', () => {
    const union = {
      anyOf: [
        { properties: { payload: { properties: { a: {} } } } },
        { properties: { payload: { properties: { b: {} } } } },
      ],
    }

    expect(pruneToSchema(union, { payload: { a: 'keep me', b: 'too', c: 'drop' } })).toEqual({
      payload: { a: 'keep me', b: 'too' },
    })
  })

  it('resolves local $defs references, including factored schemas and self-references', () => {
    const item = {
      type: 'object',
      properties: { id: { type: 'string' } },
      additionalProperties: false,
    }
    const schema = {
      type: 'object',
      properties: {
        a: { $ref: '#/$defs/Item' },
        b: { $ref: '#/$defs/Item' },
        loop: { $ref: '#/$defs/Loop' },
      },
      $defs: { Item: item, Loop: { $ref: '#/$defs/Loop' } },
    }
    const value = { a: { id: '1', internal: 1 }, b: [{ id: '2', internal: 2 }], extra: 1 }

    expect(pruneToSchema(schema, { a: value.a, loop: { x: 1 } })).toEqual({
      a: { id: '1' },
      loop: { x: 1 },
    })
    expect(
      pruneToSchema(
        {
          properties: { b: { type: 'array', items: { $ref: '#/$defs/Item' } } },
          $defs: { Item: item },
        },
        { b: value.b },
      ),
    ).toEqual({
      b: [{ id: '2' }],
    })
    expect(pruneToSchema({ $ref: '#/$defs/Missing' }, { a: 1 })).toEqual({ a: 1 })
    expect(pruneToSchema({ $ref: '#/components/x', $defs: {} }, { a: 1 })).toEqual({ a: 1 })
  })

  it('merges the properties of every object branch of nested anyOf', () => {
    const union = { anyOf: [{ anyOf: [{ properties: { a: {} } }] }, { properties: { b: {} } }] }

    expect(pruneToSchema(union, { a: 1, b: 2, c: 3 })).toEqual({ a: 1, b: 2 })
  })
})
