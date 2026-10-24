import { describe, expect, it } from 'vitest'

import { mergeOutputBranches } from './merged-output.mts'
import { rewriteRefs, scopedSchema } from './scoped-schema.mts'

const output = (id: string, defs: Record<string, unknown>) => ({
  type: 'object' as const,
  properties: { [id]: { $ref: '#/$defs/Wrapper' } },
  $defs: defs,
})
const id = { type: 'string', minLength: 1 }

describe('scopedSchema', () => {
  it('moves definitions and references under the option prefix', () => {
    expect(
      scopedSchema(
        { type: 'object', properties: { a: { $ref: '#/$defs/Id' } }, $defs: { Id: id } },
        3,
      ),
    ).toEqual({
      body: { type: 'object', properties: { a: { $ref: '#/$defs/Option3_Id' } } },
      definitions: { Option3_Id: id },
    })
    expect(scopedSchema({ type: 'object' }, 0).definitions).toEqual({})
  })

  it('leaves references that are not local definitions alone', () => {
    expect(
      rewriteRefs({ $ref: '#/components/x', n: 1, list: [{ $ref: 7 }] }, (name) => name),
    ).toEqual({
      $ref: '#/components/x',
      n: 1,
      list: [{ $ref: 7 }],
    })
  })
})

describe('mergeOutputBranches', () => {
  it('shares one branch between options whose outputs are equal', () => {
    const one = output('a', { Wrapper: id })
    const merged = mergeOutputBranches([
      { option: 'first', outputSchema: one },
      { option: 'second', outputSchema: structuredClone(one) },
      { option: 'third', outputSchema: output('b', { Wrapper: id }) },
    ])

    expect(merged.branches).toHaveLength(2)
    expect([...merged.indexes]).toEqual([
      ['first', 0],
      ['second', 0],
      ['third', 1],
    ])
  })

  it('stores definitions with equal bodies once and rewrites references to the survivor', () => {
    const merged = mergeOutputBranches([
      { option: 'first', outputSchema: output('a', { Wrapper: { $ref: '#/$defs/Id' }, Id: id }) },
      { option: 'second', outputSchema: output('b', { Wrapper: { $ref: '#/$defs/Id' }, Id: id }) },
    ])

    expect(Object.keys(merged.definitions)).toEqual([
      'Option0_Wrapper',
      'Option0_Id',
      'Option1_Wrapper',
    ])
    expect(merged.definitions['Option0_Wrapper']).toEqual({ $ref: '#/$defs/Option0_Id' })
    expect(merged.definitions['Option1_Wrapper']).toEqual({ $ref: '#/$defs/Option0_Id' })
    expect(merged.branches[1]).toEqual({
      type: 'object',
      properties: { b: { $ref: '#/$defs/Option1_Wrapper' } },
    })
  })

  it('rewrites a kept definition that points at a deduplicated one', () => {
    const merged = mergeOutputBranches([
      { option: 'first', outputSchema: output('a', { Wrapper: id, Id: id }) },
      {
        option: 'second',
        outputSchema: output('b', { Id: id, Wrapper: { items: { $ref: '#/$defs/Id' } } }),
      },
    ])

    expect(merged.definitions['Option1_Wrapper']).toEqual({
      items: { $ref: '#/$defs/Option0_Wrapper' },
    })
    expect(merged.branches[1]).toEqual({
      type: 'object',
      properties: { b: { $ref: '#/$defs/Option1_Wrapper' } },
    })
  })
})
