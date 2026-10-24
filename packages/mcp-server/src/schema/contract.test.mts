import { describe, expect, it } from 'vitest'

import { assertLocalSchemaRefs, readFixture } from '../test-helpers.mts'
import { closeDeclaredInputObjects, factorToolSchema } from './contract.mts'
import { findSchemaViolation } from './validator.mts'

type Golden = { input: Record<string, unknown>; expected: string }
const golden = readFixture('schema-core.json') as { factor: Golden; close: Golden }
const ID = '00000000-0000-4000-8000-000000000001'

describe('closeDeclaredInputObjects', () => {
  it('closes declared objects in root alternatives while keeping arbitrary maps open', () => {
    const closed = closeDeclaredInputObjects({
      type: 'object',
      oneOf: [
        { type: 'object', properties: { id: { type: 'string' } } },
        { type: 'object', properties: { config: { type: 'object', additionalProperties: true } } },
      ],
    })

    expect(closed).toMatchObject({
      oneOf: [
        { additionalProperties: false },
        { additionalProperties: false, properties: { config: { additionalProperties: true } } },
      ],
    })
    expect(closed).not.toHaveProperty('additionalProperties')
  })

  it('preserves boolean property schemas and pre-existing local references', () => {
    const schema = {
      type: 'object',
      properties: { forbidden: false, allowed: { $ref: '#/$defs/Allowed' } },
      $defs: { Allowed: { type: 'object', properties: { type: { type: 'string' } } } },
    }
    const closed = closeDeclaredInputObjects(schema)

    expect(closed).toMatchObject({
      properties: { forbidden: false, allowed: { $ref: '#/$defs/Allowed' } },
      $defs: { Allowed: { additionalProperties: false } },
    })
    assertLocalSchemaRefs(factorToolSchema(closed))
    expect(findSchemaViolation(closed, { allowed: { type: 'ok' } })).toBeNull()
    expect(findSchemaViolation(closed, { allowed: { type: 'ok', extra: true } })).not.toBeNull()
    expect(findSchemaViolation(closed, { forbidden: true })).not.toBeNull()
  })

  it('returns the cached result for the same schema object', () => {
    const schema = { type: 'object', properties: { id: { type: 'string' } } }

    expect(closeDeclaredInputObjects(schema)).toBe(closeDeclaredInputObjects(schema))
  })

  it('matches the recorded output byte for byte', () => {
    const closed = closeDeclaredInputObjects(structuredClone(golden.close.input))

    expect(JSON.stringify(closed)).toBe(golden.close.expected)
  })
})

describe('factorToolSchema', () => {
  const item = {
    type: 'object',
    properties: { id: { type: 'string', format: 'uuid' }, title: { type: 'string' } },
    required: ['id', 'title'],
    additionalProperties: false,
  }

  it('factors repeated schema nodes only inside this tool and preserves local definitions', () => {
    const schema = {
      type: 'object',
      properties: {
        first: { type: 'array', items: item },
        second: { type: 'array', items: item },
        third: item,
      },
      $defs: { Existing: { type: 'string' } },
    }
    const factored = factorToolSchema(schema)
    const defs = factored['$defs'] as Record<string, unknown>
    const refs = JSON.stringify(factored).match(/#\/\$defs\/S\d+/g) ?? []

    expect(JSON.stringify(factored).length).toBeLessThan(JSON.stringify(schema).length)
    expect(defs).toMatchObject({ Existing: { type: 'string' } })
    expect(refs.length).toBeGreaterThanOrEqual(2)
    for (const ref of refs) expect(defs).toHaveProperty(ref.slice('#/$defs/'.length))
    expect(schema.properties.third).toBe(item)
    assertLocalSchemaRefs(factored)
    for (const value of [
      { first: [], second: [], third: { id: ID, title: 'A' } },
      { first: [{ id: ID, title: 'A' }], second: [], third: { id: ID } },
      { first: [42], second: [], third: { id: ID, title: 'A' } },
    ])
      expect(findSchemaViolation(factored, value) === null).toBe(
        findSchemaViolation(schema, value) === null,
      )
  })

  it('leaves a schema alone when factoring would not shrink it', () => {
    const small = { a: { type: 'string' }, b: { type: 'string' } }
    const schema = { type: 'object', properties: small }

    expect(factorToolSchema(schema)).toBe(schema)
  })

  it('does not hoist nodes that are already references', () => {
    const ref = { $ref: '#/$defs/Existing', description: 'x'.repeat(60) }
    const schema = { type: 'object', properties: { a: ref, b: ref }, $defs: { Existing: {} } }

    expect(factorToolSchema(schema)['$defs']).toEqual({ Existing: {} })
  })

  it('compares nodes with undefined members and unordered keys as equal', () => {
    const long = 'x'.repeat(50)
    const schema = {
      type: 'object',
      properties: {
        a: { type: 'string', title: long, default: undefined },
        b: { default: undefined, title: long, type: 'string' },
      },
    }
    const defs = factorToolSchema(schema)['$defs'] as Record<string, unknown>

    expect(Object.keys(defs)).toEqual(['S1'])
  })

  it('is idempotent and cached per schema object', () => {
    const schema = { type: 'object', properties: { a: item, b: item } }
    const factored = factorToolSchema(schema)

    expect(factorToolSchema(schema)).toBe(factored)
    expect(JSON.stringify(factorToolSchema(factored))).toBe(JSON.stringify(factored))
  })

  it('matches the recorded output byte for byte, skipping taken S{n} names', () => {
    const factored = factorToolSchema(structuredClone(golden.factor.input))

    expect(JSON.stringify(factored)).toBe(golden.factor.expected)
    expect(Object.keys(factored['$defs'] as object)).toEqual(['S1', 'S2', 'S3'])
  })
})
