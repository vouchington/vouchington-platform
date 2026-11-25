import { describe, expect, it } from 'vitest'

import { assertLocalSchemaRefs } from './local-refs.mts'

describe('assertLocalSchemaRefs', () => {
  it('accepts schemas whose references all resolve within root $defs', () => {
    expect(() =>
      assertLocalSchemaRefs({
        type: 'object',
        properties: {
          item: { $ref: '#/$defs/Item' },
          list: { type: 'array', items: { $ref: '#/$defs/Item' } },
          choice: { oneOf: [{ $ref: '#/$defs/Item' }, { type: 'null' }] },
          ignoredConst: { const: { $ref: '#/external/Ignored' } },
        },
        patternProperties: { '^x-': { $ref: '#/$defs/Item' } },
        additionalProperties: { $ref: '#/$defs/Item' },
        $defs: {
          Item: { type: 'object', properties: { id: { type: 'string' } } },
        },
      }),
    ).not.toThrow()
  })

  it('rejects non-object roots', () => {
    for (const invalid of [null, undefined, 'string', 42, []]) {
      expect(() => assertLocalSchemaRefs(invalid)).toThrow('Expected an object schema')
    }
  })

  it('rejects external, nested-path, and non-string $ref values', () => {
    expect(() =>
      assertLocalSchemaRefs({
        type: 'object',
        properties: { a: { $ref: '#/components/schemas/Item' } },
      }),
    ).toThrow('Non-local MCP schema reference: #/components/schemas/Item')
    expect(() =>
      assertLocalSchemaRefs({
        type: 'object',
        items: { $ref: '#/$defs/Nested/Path' },
        $defs: { Nested: {} },
      }),
    ).toThrow('Non-local MCP schema reference: #/$defs/Nested/Path')
    expect(() =>
      assertLocalSchemaRefs({
        type: 'object',
        anyOf: [{ $ref: 123 }],
      }),
    ).toThrow('Non-local MCP schema reference: 123')
  })

  it('rejects dangling $defs references including inherited Object.prototype keys', () => {
    expect(() =>
      assertLocalSchemaRefs({
        type: 'object',
        properties: { a: { $ref: '#/$defs/Missing' } },
        $defs: { Present: { type: 'string' } },
      }),
    ).toThrow('Dangling MCP schema reference: #/$defs/Missing')
    expect(() =>
      assertLocalSchemaRefs({
        type: 'object',
        properties: { a: { $ref: '#/$defs/toString' } },
        $defs: {},
      }),
    ).toThrow('Dangling MCP schema reference: #/$defs/toString')
    expect(() =>
      assertLocalSchemaRefs({
        type: 'object',
        allOf: [{ $ref: '#/$defs/Missing' }],
        $defs: ['not-an-object'],
      }),
    ).toThrow('Dangling MCP schema reference: #/$defs/Missing')
  })

  it('checks references inside definitions, conditional keywords, and ignores non-object children', () => {
    expect(() =>
      assertLocalSchemaRefs({
        type: 'object',
        definitions: { Helper: { $ref: '#/$defs/Missing' } },
      }),
    ).toThrow('Dangling MCP schema reference: #/$defs/Missing')
    expect(() =>
      assertLocalSchemaRefs({
        type: 'object',
        if: { properties: { x: null } },
        else: { $ref: '#/$defs/Missing' },
      }),
    ).toThrow('Dangling MCP schema reference: #/$defs/Missing')
    expect(() =>
      assertLocalSchemaRefs({
        type: 'object',
        properties: 'not-an-object',
        oneOf: ['not-an-object'],
      }),
    ).not.toThrow()
  })
})
