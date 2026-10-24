import { describe, expect, it } from 'vitest'

import { dateTimeCases } from '../test-helpers.mts'
import { findSchemaViolation } from './validator.mts'

const SCHEMA = {
  type: 'object',
  properties: { page: { type: 'object', properties: { next: { type: 'boolean' } } } },
  required: ['page'],
  additionalProperties: false,
}

const MERGED_SCHEMA = {
  type: 'object',
  oneOf: [
    {
      type: 'object',
      properties: {
        option: { type: 'string', enum: ['get'] },
        arguments: { $ref: '#/$defs/GetArgs' },
      },
      required: ['option', 'arguments'],
      additionalProperties: false,
    },
    {
      type: 'object',
      properties: {
        option: { type: 'string', enum: ['list'] },
        arguments: { type: 'object', additionalProperties: false },
      },
      required: ['option', 'arguments'],
      additionalProperties: false,
    },
  ],
  $defs: {
    GetArgs: {
      type: 'object',
      properties: { page: { $ref: '#/$defs/Page' } },
      required: ['page'],
      additionalProperties: false,
    },
    Page: {
      type: 'object',
      properties: { after: { type: 'string' } },
      required: ['after'],
      additionalProperties: false,
    },
  },
}

describe('findSchemaViolation', () => {
  it('returns null for a conforming value', () => {
    expect(findSchemaViolation(SCHEMA, { page: { next: true } })).toBeNull()
  })

  it('names where and which rule failed', () => {
    expect(findSchemaViolation(SCHEMA, { page: { next: 'yes' } })).toBe(
      '/page/next must be boolean',
    )
  })

  it('uses the root path for a violation of the whole value', () => {
    expect(findSchemaViolation(SCHEMA, 'not an object')).toBe('/ must be object')
  })

  it('never includes the offending value', () => {
    const violation = findSchemaViolation(SCHEMA, { page: { next: 'secret-value-123' } })

    expect(violation).not.toContain('secret-value-123')
  })

  it('keeps validating after the schema is cached', () => {
    expect(findSchemaViolation(SCHEMA, { page: {} })).toBeNull()
    expect(findSchemaViolation(SCHEMA, {})).not.toBeNull()
  })

  it('reports the selected option argument error through local references', () => {
    const input = { option: 'get', arguments: { page: { after: 42 } } }

    expect(findSchemaViolation(MERGED_SCHEMA, input)).toBe('/page/after must be string')
    expect(findSchemaViolation(MERGED_SCHEMA, input)).toBe('/page/after must be string')
  })

  it('still rejects an unknown option and an extra envelope field', () => {
    expect(findSchemaViolation(MERGED_SCHEMA, { option: 'other', arguments: {} })).not.toBeNull()
    expect(
      findSchemaViolation(MERGED_SCHEMA, {
        option: 'get',
        arguments: { page: { after: 'cursor' } },
        extra: true,
      }),
    ).not.toBeNull()
  })

  it('keeps generic oneOf diagnostics when there is no merged option selector', () => {
    const schema = {
      oneOf: [
        {
          type: 'object',
          properties: { action: { enum: ['open'] }, arguments: { type: 'object' } },
          required: ['action', 'arguments'],
        },
        {
          type: 'object',
          properties: { action: { enum: ['close'] }, arguments: { type: 'object' } },
          required: ['action', 'arguments'],
        },
      ],
    }

    expect(findSchemaViolation(schema, { action: 'other', arguments: {} })).not.toBeNull()
  })

  it('skips the selected-option diagnostic for non-object inputs and non-union schemas', () => {
    expect(findSchemaViolation(MERGED_SCHEMA, 'text')).not.toBeNull()
    expect(findSchemaViolation(MERGED_SCHEMA, null)).not.toBeNull()
    expect(findSchemaViolation({ type: 'object', required: ['a'] }, { arguments: 1 })).toBe(
      "/ must have required property 'a'",
    )
  })

  it('resolves draft-07 definitions when reporting a selected option argument error', () => {
    const schema = {
      oneOf: [
        {
          properties: {
            option: { enum: ['get'] },
            arguments: { $ref: '#/definitions/Args' },
          },
          required: ['option', 'arguments'],
        },
      ],
      definitions: { Args: { type: 'object', properties: { id: { type: 'string' } } } },
    }

    expect(findSchemaViolation(schema, { option: 'get', arguments: { id: 'ok' } })).toBeNull()
    expect(findSchemaViolation(schema, { option: 'get', arguments: { id: 42 } })).toBe(
      '/id must be string',
    )
  })

  it('reports a selected option argument error when the union has no definitions', () => {
    const schema = {
      oneOf: [
        {
          properties: {
            option: { enum: ['get'] },
            arguments: { type: 'object', required: ['id'] },
          },
          required: ['option', 'arguments'],
        },
      ],
    }

    expect(findSchemaViolation(schema, { option: 'get', arguments: {} })).toBe(
      "/ must have required property 'id'",
    )
  })
})

describe('date-time contract', () => {
  const schema = { type: 'string', format: 'date-time' }

  it.each(dateTimeCases)('$id', ({ value, valid }) => {
    expect(findSchemaViolation(schema, value) === null).toBe(valid)
  })

  it('reads an hour-only offset', () => {
    expect(findSchemaViolation(schema, '2015-07-01T00:59:60+01')).toBeNull()
    expect(findSchemaViolation(schema, '2015-07-02T00:59:60+01')).not.toBeNull()
  })

  it('places a leap second on the last day of a leap-year February', () => {
    expect(findSchemaViolation(schema, '2024-02-29T23:59:60Z')).toBeNull()
    expect(findSchemaViolation(schema, '2024-02-28T23:59:60Z')).not.toBeNull()
  })

  it('enforces the format through nested references and cached schemas', () => {
    const nested = {
      type: 'object',
      properties: { timestamp: { $ref: '#/$defs/Timestamp' } },
      $defs: { Timestamp: schema },
    }

    expect(findSchemaViolation(nested, { timestamp: '1990-12-31T23:59:60Z' })).toBeNull()
    expect(findSchemaViolation(nested, { timestamp: '2026-10-09T23:59:60Z' })).toBe(
      '/timestamp must match format "date-time"',
    )
  })
})
