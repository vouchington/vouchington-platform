import { describe, expect, it } from 'vitest'
import { RequestContractValidatorRegistry } from './index.mts'

const registry = new RequestContractValidatorRegistry({
  components: { Name: { type: 'string', minLength: 1 } },
  operations: {
    create: {
      body: {
        type: 'object',
        additionalProperties: false,
        properties: { name: { $ref: '#/components/schemas/Name' } },
        required: ['name'],
      },
      header: {
        type: 'object',
        properties: { 'idempotency-key': { type: 'string', format: 'uuid' } },
        required: ['idempotency-key'],
      },
    },
    read: {
      path: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' } },
        required: ['id'],
      },
      query: { type: 'object', properties: { limit: { type: 'integer', minimum: 1 } } },
    },
    noSchema: {},
    deny: { body: false },
  },
})

describe('RequestContractValidatorRegistry', () => {
  it('resolves component references and rejects invalid bodies', () => {
    expect(registry.validateBody('create', { name: 'Alice' })).toBeNull()
    expect(registry.validateBody('create', { name: '' })).toMatchObject({
      message: expect.stringContaining('Invalid request body'),
    })
    expect(registry.validateBody('create', { name: 'Alice', extra: true })).not.toBeNull()
    expect(registry.validateBody('deny', {})).not.toBeNull()
  })

  it('checks formats, query bounds, and lowercase header names', () => {
    expect(registry.validate('read', 'path', { id: 'not-uuid' })).not.toBeNull()
    expect(
      registry.validate('read', 'path', { id: '018f8780-6a0f-7c94-8d6c-b6b6d0b12a41' }),
    ).toBeNull()
    expect(registry.validate('read', 'query', { limit: 0 })).not.toBeNull()
    expect(registry.validate('read', 'query', { limit: 2 })).toBeNull()
    expect(
      registry.validate('create', 'header', {
        'Idempotency-Key': '018f8780-6a0f-7c94-8d6c-b6b6d0b12a41',
      }),
    ).toBeNull()
    expect(registry.validate('create', 'header', { 'IDEMPOTENCY-KEY': 'invalid' })).not.toBeNull()
  })

  it('distinguishes absent carriers from a supplied undefined value', () => {
    expect(registry.validateOperation('create', {})).toBeNull()
    expect(registry.validateOperation('create', { path: { any: true } })).toBeNull()
    expect(registry.validateOperation('create', { body: undefined })).not.toBeNull()
    expect(registry.validateOperation('noSchema', { body: undefined })).toBeNull()
    expect(registry.validateOperation('create', { body: { name: '' }, header: {} })).toMatchObject({
      message: expect.stringContaining('Invalid request body'),
    })
  })

  it('rejects case-insensitive header collisions regardless of insertion order', () => {
    const entries = [
      ['Idempotency-Key', 'invalid'],
      ['idempotency-key', '018f8780-6a0f-7c94-8d6c-b6b6d0b12a41'],
    ]
    for (const headers of [Object.fromEntries(entries), Object.fromEntries(entries.toReversed())]) {
      expect(registry.validate('create', 'header', headers)).toEqual({
        message: 'Invalid request header',
      })
    }
  })

  it('fails closed for unknown operations on both entry points', () => {
    expect(registry.hasOperation('create')).toBe(true)
    expect(registry.hasOperation('missing')).toBe(false)
    expect(() => registry.validateOperation('missing', {})).toThrow('No request contract')
    expect(() => registry.validate('missing', 'body', {})).toThrow('No request contract')
  })

  it('rejects malformed bundles, schemas, references, and formats when compiled', () => {
    expect(() => new RequestContractValidatorRegistry(null!)).toThrow(TypeError)
    expect(
      () => new RequestContractValidatorRegistry({ components: {}, operations: { x: null! } }),
    ).toThrow(TypeError)
    expect(
      () =>
        new RequestContractValidatorRegistry({ components: {}, operations: { x: { body: null } } }),
    ).toThrow()
    expect(
      () =>
        new RequestContractValidatorRegistry({
          components: {},
          operations: { x: { body: { $ref: '#/components/schemas/Missing' } } },
        }),
    ).toThrow()
    expect(
      () =>
        new RequestContractValidatorRegistry({
          components: {},
          operations: { x: { body: { type: 'string', format: 'not-registered' } } },
        }),
    ).toThrow()
  })
})
