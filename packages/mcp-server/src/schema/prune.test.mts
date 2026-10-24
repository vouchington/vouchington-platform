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

  it('merges the properties of every object branch of nested anyOf', () => {
    const union = { anyOf: [{ anyOf: [{ properties: { a: {} } }] }, { properties: { b: {} } }] }

    expect(pruneToSchema(union, { a: 1, b: 2, c: 3 })).toEqual({ a: 1, b: 2 })
  })
})
