import { describe, expect, it } from 'vitest'

import { findSchemaViolation } from './validator.mts'
import { nullable, objectSchema, oneOfSchema, outcomeSchema, successSchema } from './shapes.mts'

describe('output schema shapes', () => {
  it('builds a closed object requiring every property but the optional ones', () => {
    expect(objectSchema({ a: { type: 'string' }, b: { type: 'number' } }, ['b'])).toEqual({
      type: 'object',
      properties: { a: { type: 'string' }, b: { type: 'number' } },
      required: ['a'],
      additionalProperties: false,
    })
    expect(objectSchema({ a: { type: 'string' } })).toHaveProperty('required', ['a'])
  })

  it('prefixes a success flag', () => {
    const schema = successSchema({ id: { type: 'string' } }, ['id'])

    expect(schema.properties).toEqual({ success: { const: true }, id: { type: 'string' } })
    expect(schema.required).toEqual(['success'])
  })

  it('wraps variants in a root object oneOf', () => {
    const variants = [objectSchema({ a: {} }), objectSchema({ b: {} })]

    expect(oneOfSchema(...variants)).toEqual({ type: 'object', oneOf: variants })
  })

  it('admits the miss branch of a lookup outcome', () => {
    const schema = outcomeSchema('found', { topic: { type: 'string' } })

    expect(findSchemaViolation(schema, { found: true, topic: 'a' })).toBeNull()
    expect(findSchemaViolation(schema, { found: false, error: 'Topic not found' })).toBeNull()
    expect(findSchemaViolation(schema, { found: true })).not.toBeNull()
    expect(findSchemaViolation(outcomeSchema('success', {}), { success: false, error: 'x' })).toBe(
      null,
    )
  })

  it('spells nullable with null first', () => {
    expect(nullable({ type: 'string' })).toEqual({ anyOf: [{ type: 'null' }, { type: 'string' }] })
  })
})
