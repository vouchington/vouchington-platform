import { describe, expect, it, vi } from 'vitest'

import {
  findSchemaViolation,
  getOptionOutputSchema,
  validateOptionOutputPointers,
} from '../schema/index.mts'
import type { McpToolMeta } from '../types.mts'
import { assertLocalSchemaRefs, readFixture } from '../test-helpers.mts'
import { createMergedTool, type MergedToolSource } from './create-merged-tool.mts'

const routeA = { method: 'GET' as const, path: '/examples/:id' }
const routeB = { method: 'GET' as const, path: '/examples' }
const invocation = vi.fn<(option: string, args: unknown, context: unknown) => unknown>(
  (option, args) => ({ success: true, [option]: args }),
)

type Gates = { plan?: string; scopes?: string[]; roles?: Record<string, boolean> }
type Source = MergedToolSource<string, { request: string }> & { gates: Gates }

function source(option: 'get' | 'list', gates: Gates = {}): Source {
  const parameters =
    option === 'get'
      ? {
          type: 'object',
          properties: { id: { $ref: '#/$defs/Id' } },
          required: ['id'],
          $defs: { Id: { type: 'string', minLength: 1 } },
        }
      : {
          type: 'object',
          properties: { after: { $ref: '#/$defs/Id' } },
          $defs: { Id: { type: 'string', minLength: 1 } },
        }
  return {
    gates,
    schema: { description: `${option} example`, parameters },
    function: (_user) => (args, context) => invocation(option, args, context),
    ...(gates.roles ? { roles: gates.roles } : {}),
    meta: {
      title: `${option} example`,
      annotations: { readOnlyHint: true },
      api: [option === 'get' ? routeA : routeB],
      outputSchema: {
        type: 'object',
        properties: { success: { type: 'boolean' }, [option]: { $ref: '#/$defs/Result' } },
        required: ['success', option],
        additionalProperties: false,
        $defs: {
          Result: {
            type: 'object',
            properties:
              option === 'get' ? { id: { type: 'string' } } : { after: { type: 'string' } },
            additionalProperties: false,
          },
        },
      },
    },
  }
}

const compatibilityKey = (candidate: MergedToolSource<string, { request: string }>) => {
  const { gates } = candidate as Source
  return JSON.stringify({
    plan: gates.plan ?? 'free',
    scopes: gates.scopes ?? null,
    roles: candidate.roles ?? null,
  })
}
const build = (name: string, options: Array<[string, Source]>) =>
  createMergedTool(
    name,
    'Title',
    options.map(([option, entry]) => ({ option, source: entry })),
    { compatibilityKey },
  )
const merged = build('read_example', [
  ['get', source('get')],
  ['list', source('list')],
])
const meta = merged.meta as McpToolMeta

describe('createMergedTool', () => {
  it('closes the envelope and each source contract before dispatch', async () => {
    invocation.mockClear()
    for (const args of [
      { option: 'other', arguments: {} },
      { option: 'get', arguments: { after: 'cursor' } },
      { option: 'list', arguments: { id: 'one' } },
      { option: 'get', arguments: { id: 'one' }, extra: true },
      { option: 'get', arguments: { id: 'one', extra: true } },
      { option: 'get' },
    ]) {
      expect(findSchemaViolation(merged.schema.parameters!, args)).not.toBeNull()
      expect(() => merged.function('user')(args)).toThrow('Invalid merged tool arguments')
    }
    expect(invocation).not.toHaveBeenCalled()
    const args = { option: 'get', arguments: { id: 'one' } }
    expect(findSchemaViolation(merged.schema.parameters!, args)).toBeNull()
    expect(await merged.function('user')(args, { request: 'r1' })).toEqual({
      success: true,
      get: { id: 'one' },
    })
    expect(invocation).toHaveBeenCalledExactlyOnceWith('get', { id: 'one' }, { request: 'r1' })
  })

  it('selects only the chosen REST route, source output contract and audit option', () => {
    const args = { option: 'list', arguments: { after: 'cursor' } }

    expect(meta.selectApi?.(args)).toEqual([routeB])
    expect(meta.selectApi?.({ option: 'nope', arguments: {} })).toEqual([])
    expect(meta.auditOption?.(args)).toBe('list')
    expect(meta.auditOption?.({ option: 'nope' })).toBeNull()
    const selectedOutput = meta.selectOutputSchema?.(args)
    expect(findSchemaViolation(selectedOutput!, { success: true, list: { after: 'c' } })).toBeNull()
    expect(
      findSchemaViolation(selectedOutput!, { success: true, get: { id: 'one' } }),
    ).not.toBeNull()
    expect(meta.selectOutputSchema?.({ option: 'nope' })).toBeUndefined()
  })

  it("falls back to a source's whole api when it narrows nothing", () => {
    const narrowing = source('get')
    narrowing.meta = { ...narrowing.meta!, selectApi: (args) => (args['id'] ? [routeA] : []) }
    const tool = build('read_narrow', [
      ['get', narrowing],
      ['list', source('list')],
    ])
    const selectApi = (tool.meta as McpToolMeta).selectApi!

    expect(selectApi({ option: 'get', arguments: { id: 'x' } })).toEqual([routeA])
    expect(selectApi({ option: 'get', arguments: {} })).toEqual([])
    expect(selectApi({ option: 'list', arguments: {} })).toEqual([routeB])
  })

  it('publishes selected output pointers after deduplicating shared source contracts', () => {
    const tool = build('read_dedup', [
      ['first', source('get')],
      ['shared', source('get')],
      ['last', source('list')],
    ])
    const pointers = { first: '#/anyOf/0', shared: '#/anyOf/0', last: '#/anyOf/1' }
    const output = tool.meta!.outputSchema!

    expect(tool.meta).toMatchObject({ optionOutputPointers: pointers })
    expect(() =>
      validateOptionOutputPointers(tool.schema.name, tool.schema.parameters!, output, pointers),
    ).not.toThrow()
    const selected = getOptionOutputSchema(output, pointers.first)
    expect(findSchemaViolation(selected, { success: true, get: { id: 'one' } })).toBeNull()
    expect(findSchemaViolation(selected, { success: true, list: { after: 'c' } })).not.toBeNull()
    expect(output['$defs']).toHaveProperty('Option0_Result')
    expect(output['$defs']).not.toHaveProperty('Option0_Id')
    assertLocalSchemaRefs(output)
    assertLocalSchemaRefs(tool.schema.parameters)
  })

  it('points shared and single-option outputs at their complete output root', () => {
    const shared = build('read_shared', [
      ['first', source('get')],
      ['shared', source('get')],
    ])
    const single = build('read_single', [['get', source('get')]])

    expect(shared.meta).toMatchObject({ optionOutputPointers: { first: '#', shared: '#' } })
    expect(single.meta).toMatchObject({ optionOutputPointers: { get: '#' } })
    expect(single.meta!.outputSchema).not.toHaveProperty('anyOf')
  })

  it('supports one closed option and a source without parameters, and refuses an empty group', async () => {
    const bare = source('get')
    bare.schema = { description: null, parameters: null }
    const tool = build('single', [['get', bare]])
    const args = { option: 'get', arguments: {} }

    expect(findSchemaViolation(tool.schema.parameters!, args)).toBeNull()
    expect(
      findSchemaViolation(tool.schema.parameters!, { ...args, arguments: { x: 1 } }),
    ).not.toBeNull()
    expect(await tool.function('user')(args)).toEqual({ success: true, get: {} })
    expect(tool.schema.description).toBe('get: ')
    expect(() => build('empty', [])).toThrow('empty needs at least one option')
  })

  it('merges identical routes once and reports none as null', () => {
    const twin = build('twin', [
      ['get', source('get')],
      ['peek', source('get')],
    ])
    const none = source('get')
    none.meta = { ...none.meta!, api: null }
    const quiet = build('quiet', [['get', none]])
    const noMeta = source('get')
    noMeta.meta = { title: 't', api: null, outputSchema: none.meta.outputSchema! }

    expect(twin.meta!.api).toEqual([routeA])
    expect(quiet.meta!.api).toBeNull()
    expect(build('plain', [['get', noMeta]]).meta!.api).toBeNull()
  })

  it('publishes no $defs when no source output needs one, and no route for a routeless source', () => {
    const plain = source('get')
    plain.meta = { title: 't', api: null, outputSchema: { type: 'object', properties: {} } }
    const tool = build('plain', [['get', plain]])

    expect(tool.meta!.outputSchema).toEqual({ type: 'object', properties: {} })
    expect(tool.meta!.selectApi!({ option: 'get', arguments: {} })).toEqual([])
  })

  it('refuses missing declarations and duplicate options', () => {
    const missing = source('get')
    delete missing.meta!.outputSchema
    const lacking = source('list')
    delete lacking.meta
    const refuse = (list: Array<[string, Source]>) => build('bad', list)

    expect(() => refuse([['get', missing]])).toThrow('bad needs source output schemas')
    expect(() =>
      refuse([
        ['get', source('get')],
        ['list', lacking],
      ]),
    ).toThrow('incompatible')
    expect(() =>
      refuse([
        ['get', source('get')],
        ['get', source('list')],
      ]),
    ).toThrow('bad has duplicate options')
  })

  it.each([
    ['plan', { plan: 'plus' }],
    ['scopes', { scopes: ['posts:read'] }],
    ['roles', { roles: { administrator: true } }],
  ])('rejects incompatible declared %s metadata through the compatibility key', (_field, gates) => {
    expect(() =>
      build('read_example', [
        ['get', source('get')],
        ['list', source('list', gates)],
      ]),
    ).toThrow('incompatible declared metadata')
  })

  it('carries the first source roles and application meta into the merged tool', () => {
    const gated = build('gated', [
      ['get', source('get', { roles: { member: true } })],
      ['list', source('list', { roles: { member: true } })],
    ])

    expect(gated.roles).toEqual({ member: true })
    expect(merged.roles).toBeUndefined()
    expect(meta).toMatchObject({ title: 'Title', annotations: { readOnlyHint: true } })
  })

  it('produces the recorded schema and metadata byte for byte, scoped as Option{n}_ and S{n}', () => {
    const recorded = readFixture('merged-tool.json') as {
      options: Array<{ option: string; source: Source }>
      expected: string
    }
    const tool = createMergedTool(
      'read_items',
      'Read Items',
      recorded.options.map(({ option, source: entry }) => ({
        option,
        source: { ...entry, function: () => () => null },
      })),
      { compatibilityKey: (entry) => JSON.stringify(entry.roles) },
    )
    const { selectApi: _a, selectOutputSchema: _s, auditOption: _o, ...rest } = tool.meta!

    expect(JSON.stringify({ roles: tool.roles, schema: tool.schema, meta: rest })).toBe(
      recorded.expected,
    )
  })
})
