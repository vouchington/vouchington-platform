import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  composeQueryContracts,
  createPaginationParser,
  csvEnumFilter,
  defineQueryContract,
  enumFilter,
  parseBoundedIntegerLimit,
  queryBoolean,
  queryCsvArray,
  queryEnum,
  queryInteger,
  queryNullableBoolean,
  queryNumber,
  queryString,
  queryUuid,
  queryUuidOrUri,
  stringFilter,
  withQueryContract,
} from './index.mts'
import type { PaginationConfig } from './types.mts'

const parser = createPaginationParser({
  cursor: { paramName: 'after', legacyParamNames: ['cursor'] },
  limit: { paramName: 'limit', min: 2, max: 10, default: 5 },
  filters: {
    order: enumFilter('order', ['recent', 'popular'] as const),
    labels: csvEnumFilter('label', ['news', 'events'] as const),
    query: stringFilter('q'),
  },
})

describe('pagination parser', () => {
  it('parses caller-owned cursor, limits, and filters with descriptive metadata', () => {
    expect(
      parser.parse({
        after: 'next',
        limit: '99',
        order: 'recent',
        label: ['news,events', 'news'],
        q: 'find',
      }),
    ).toEqual({
      limit: 10,
      after: 'next',
      order: 'recent',
      labels: ['news', 'events'],
      query: 'find',
    })
    expect(
      parser.parse({ cursor: 'legacy', limit: 1, order: 'invalid', label: 'invalid', q: 1 }),
    ).toEqual({ limit: 2, after: 'legacy' })
    expect(parser.parse({ after: 'primary', cursor: 'legacy' })).toEqual({
      limit: 5,
      after: 'primary',
    })
    expect(parser.parse({ label: ['news', 1] })).toEqual({ limit: 5, labels: ['news'] })
    expect(parser.parse({ label: 1 })).toEqual({ limit: 5 })
    expect(parser.queryContract).toEqual({
      after: { kind: 'string' },
      limit: { kind: 'integer', minimum: 2, maximum: 10, default: 5 },
      order: { kind: 'enum', values: ['recent', 'popular'] },
      label: {
        kind: 'csv-array',
        items: { kind: 'enum', values: ['news', 'events'] },
        style: 'form',
        explode: false,
      },
      q: { kind: 'string' },
    })
    expectTypeOf(parser.queryContract.after.kind).toEqualTypeOf<'string'>()
    expectTypeOf(parser.queryContract.limit.minimum).toEqualTypeOf<2>()
    expectTypeOf(parser.queryContract.order.values).toEqualTypeOf<readonly ['recent', 'popular']>()
    expectTypeOf(parser.queryContract.label.kind).toEqualTypeOf<'csv-array'>()
  })

  it('rejects invalid request values and invalid configuration', () => {
    expect(() => parser.parse({ after: 1 })).toThrow('after must be a string')
    expect(() => parser.parse({ after: '' })).toThrow('after cannot be empty')
    for (const value of ['', -1, 1.2, Infinity, 'no', '1.2'])
      expect(() =>
        parseBoundedIntegerLimit(value, { paramName: 'limit', min: 1, max: 2, default: 1 }),
      ).toThrow('positive integer')
    expect(
      parseBoundedIntegerLimit(undefined, { paramName: 'limit', min: 1, max: 2, default: 1 }),
    ).toBe(1)
    for (const config of [
      { cursor: { paramName: '' }, limit: { paramName: 'limit', min: 1, max: 2, default: 1 } },
      {
        cursor: { paramName: 'after', legacyParamNames: ['after'] },
        limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
      },
      { cursor: { paramName: 'after' }, limit: { paramName: 'limit', min: 2, max: 1, default: 1 } },
      {
        cursor: { paramName: 'after' },
        limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
        filters: { '': stringFilter('q') },
      },
    ])
      expect(() => createPaginationParser(config)).toThrow(TypeError)
    expect(() =>
      createPaginationParser({
        cursor: { paramName: 'after' },
        limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
        filters: { one: stringFilter('after') },
      }),
    ).toThrow('query parameter names must be distinct')
    expect(
      createPaginationParser({
        cursor: { paramName: 'after' },
        limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
      }).parse({}),
    ).toEqual({ limit: 1 })
    const noFilters = createPaginationParser({
      cursor: { paramName: 'after' },
      limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
    })
    const assertNoFilterIndex = () => {
      // @ts-expect-error -- a parser without filters has no arbitrary query-contract keys
      void noFilters.queryContract.arbitrary
      // @ts-expect-error -- a parser without filters has no arbitrary parsed-option keys
      void noFilters.parse({}).arbitrary
    }
    expect(assertNoFilterIndex).toBeTypeOf('function')
    for (const config of [
      {
        cursor: { paramName: 'after', legacyParamNames: ['cursor'] },
        limit: { paramName: 'after', min: 1, max: 2, default: 1 },
      },
      {
        cursor: { paramName: 'after', legacyParamNames: ['cursor', 'cursor'] },
        limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
      },
      {
        cursor: { paramName: 'after', legacyParamNames: ['filter'] },
        limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
        filters: { filter: stringFilter('filter') },
      },
      {
        cursor: { paramName: 'after' },
        limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
        filters: { one: stringFilter('same'), two: stringFilter('same') },
      },
      {
        cursor: { paramName: 'after' },
        limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
        filters: { after: stringFilter('other') },
      },
      {
        cursor: { paramName: 'after' },
        limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
        filters: { ['constructor']: stringFilter('other') },
      },
      {
        cursor: { paramName: ' \t ' },
        limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
      },
      {
        cursor: { paramName: 'after\n' },
        limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
      },
      {
        cursor: { paramName: 'after\x7f' },
        limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
      },
      {
        cursor: { paramName: 'after value' },
        limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
      },
      {
        cursor: { paramName: 'after\u200b' },
        limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
      },
      {
        cursor: { paramName: 'after', legacyParamNames: 'cursor' },
        limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
      },
      {
        cursor: { paramName: 'after' },
        limit: { paramName: '__proto__', min: 1, max: 2, default: 1 },
      },
      {
        cursor: { paramName: 'after' },
        limit: null,
      },
    ] as unknown[]) {
      expect(() => createPaginationParser(config as PaginationConfig)).toThrow(TypeError)
    }
  })

  it('gives caller-supplied filters the complete query object', () => {
    const parserWithDependentFilter = createPaginationParser({
      cursor: { paramName: 'after' },
      limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
      filters: {
        dependent: {
          queryName: 'value',
          queryContract: queryString(),
          parse(value: unknown, query: Readonly<Record<string, unknown>>) {
            return query.kind === 'enabled' && typeof value === 'string' ? value : undefined
          },
        },
      },
    })
    expect(parserWithDependentFilter.parse({ kind: 'enabled', value: 'accepted' })).toEqual({
      limit: 1,
      dependent: 'accepted',
    })
  })

  it('uses immutable caller catalog snapshots for parsing and metadata', () => {
    const values = ['one', 'two']
    const enumDescriptor = enumFilter('single', values)
    const assertReadonlyCatalog = () => {
      // @ts-expect-error -- enum catalogs are immutable public metadata
      enumDescriptor.queryContract.values.push('three')
    }
    expect(assertReadonlyCatalog).toBeTypeOf('function')
    const parserWithCatalogs = createPaginationParser({
      cursor: { paramName: 'after' },
      limit: { paramName: 'limit', min: 1, max: 2, default: 1 },
      filters: {
        single: enumDescriptor,
        multiple: csvEnumFilter('multiple', values),
      },
    })
    values.push('three')
    expect(parserWithCatalogs.parse({ single: 'three', multiple: 'one,three' })).toEqual({
      limit: 1,
      multiple: ['one'],
    })
    expect(parserWithCatalogs.queryContract).toMatchObject({
      single: { values: ['one', 'two'] },
      multiple: { items: { values: ['one', 'two'] } },
    })
  })

  it('snapshots all configuration and descriptor metadata at construction', () => {
    const choices = ['one', 'two'] as string[]
    const config = {
      cursor: { paramName: 'after', legacyParamNames: ['cursor'] },
      limit: { paramName: 'limit', min: 1, max: 5, default: 2 },
      filters: {
        choice: {
          queryName: 'choice',
          queryContract: { kind: 'enum' as const, values: choices, description: 'original' },
          parse(value: unknown) {
            return value === 'one' ? value : undefined
          },
        },
      },
    }
    const snapshot = createPaginationParser(config)
    config.cursor.paramName = 'changed'
    config.cursor.legacyParamNames.push('changed')
    config.limit.paramName = 'count'
    config.limit.default = 5
    config.filters.choice.queryName = 'changed-choice'
    config.filters.choice.queryContract.description = 'changed'
    choices.push('three')
    expect(snapshot.parse({ cursor: 'cursor', limit: '1', choice: 'one' })).toEqual({
      limit: 1,
      after: 'cursor',
      choice: 'one',
    })
    expect(snapshot.queryContract).toEqual({
      after: { kind: 'string' },
      limit: { kind: 'integer', minimum: 1, maximum: 5, default: 2 },
      choice: { kind: 'enum', values: ['one', 'two'], description: 'original' },
    })
    expect(Object.isFrozen(snapshot.queryContract)).toBe(true)
    const descriptor = snapshot.queryContract['choice'] as unknown as {
      readonly values: readonly string[]
    }
    expect(Object.isFrozen(descriptor.values)).toBe(true)
  })
})

describe('query contracts', () => {
  it('creates, composes, and attaches neutral descriptors', () => {
    expect(queryString({ format: 'uuid' })).toEqual({ kind: 'string', format: 'uuid' })
    expect(queryUuid({ description: 'key' })).toEqual({
      kind: 'string',
      format: 'uuid',
      description: 'key',
    })
    expect(queryBoolean()).toEqual({ kind: 'boolean' })
    expect(queryNullableBoolean()).toEqual({ kind: 'nullable-boolean' })
    expect(queryNumber()).toEqual({ kind: 'number' })
    expect(queryUuidOrUri()).toEqual({ kind: 'uuid-or-uri' })
    expect(queryInteger({ minimum: 1, maximum: 2 })).toEqual({
      kind: 'integer',
      minimum: 1,
      maximum: 2,
    })
    expect(queryInteger({ minimum: 1, maximum: 2, default: 1 })).toEqual({
      kind: 'integer',
      minimum: 1,
      maximum: 2,
      default: 1,
    })
    expect(queryEnum(['one'], { default: 'one' })).toEqual({
      kind: 'enum',
      values: ['one'],
      default: 'one',
    })
    expect(queryCsvArray(queryString(), { description: 'many' })).toEqual({
      kind: 'csv-array',
      items: { kind: 'string' },
      style: 'form',
      explode: false,
      description: 'many',
    })
    const first = defineQueryContract({ first: queryString() })
    const second = defineQueryContract({ second: queryString() })
    expect(composeQueryContracts(first, second).queryContract).toEqual({
      first: { kind: 'string' },
      second: { kind: 'string' },
    })
    expect(() => composeQueryContracts(first, first)).toThrow('Duplicate query parameter')
    const fn = withQueryContract((value: number) => value * 2, first)
    expect(fn(2)).toBe(4)
    expect(fn.queryContract).toEqual(first.queryContract)
    const literal = composeQueryContracts(
      defineQueryContract({ after: queryString() }),
      defineQueryContract({ count: queryInteger({ minimum: 1, maximum: 5 }) }),
    )
    expectTypeOf(literal.queryContract.after.kind).toEqualTypeOf<'string'>()
    expectTypeOf(literal.queryContract.count.maximum).toEqualTypeOf<5>()
    const rejectsInvalidEnumDefault = () => {
      // @ts-expect-error -- defaults must be values from the supplied catalog
      queryEnum(['one', 'two'] as const, { default: 'three' })
    }
    expect(rejectsInvalidEnumDefault).toBeTypeOf('function')
  })
})
