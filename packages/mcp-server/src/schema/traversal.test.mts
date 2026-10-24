import { describe, expect, it } from 'vitest'

import { mapSchema, visitSchema } from './traversal.mts'

const schema = {
  type: 'object',
  properties: { a: { type: 'string' }, b: true },
  patternProperties: { '^x': { type: 'number' } },
  items: { type: 'array', items: { type: 'integer' } },
  additionalProperties: { type: 'boolean' },
  oneOf: [{ const: 1 }, 'not a schema'],
  anyOf: [{ const: 2 }],
  allOf: [{ const: 3 }],
  prefixItems: [{ const: 4 }],
  not: { const: 5 },
  if: { const: 6 },
  // oxlint-disable-next-line unicorn/no-thenable -- the `then` schema keyword
  then: { const: 7 },
  else: { const: 8 },
  contains: { const: 9 },
  propertyNames: { maxLength: 3 },
  $defs: { Unused: { type: 'string' }, Flag: false },
}

describe('visitSchema', () => {
  it('visits every schema position once, flagging only the root', () => {
    const seen: Array<[unknown, boolean]> = []
    visitSchema(schema, (node, root) => seen.push([node['const'] ?? node['type'], root]))

    expect(seen[0]).toEqual(['object', true])
    expect(seen.slice(1).every(([, root]) => !root)).toBe(true)
    expect(seen.map(([id]) => id)).toEqual([
      'object',
      'string',
      'number',
      'array',
      'integer',
      'boolean',
      5,
      6,
      7,
      8,
      9,
      undefined,
      1,
      2,
      3,
      4,
    ])
  })

  it('skips existing definitions and ignores non-object keyword values', () => {
    const seen: unknown[] = []
    visitSchema({ properties: 'nope', items: [1], oneOf: 'nope', $defs: { A: {} } }, (node) =>
      seen.push(node),
    )

    expect(seen).toHaveLength(1)
  })
})

describe('mapSchema', () => {
  const tag = (node: Record<string, unknown>, root: boolean) => ({ ...node, seen: root })

  it('rebuilds each position bottom-up without mutating the input', () => {
    const input = structuredClone(schema)
    const mapped = mapSchema(input, tag)

    expect(input).toEqual(schema)
    expect(mapped['seen']).toBe(true)
    expect((mapped['properties'] as Record<string, unknown>)['a']).toEqual({
      type: 'string',
      seen: false,
    })
    expect((mapped['properties'] as Record<string, unknown>)['b']).toBe(true)
    expect(mapped['oneOf']).toEqual([{ const: 1, seen: false }, 'not a schema'])
    expect(mapped['$defs']).toEqual(schema.$defs)
    expect(mapped['items']).toMatchObject({ seen: false, items: { seen: false } })
  })

  it('reaches definitions only when asked', () => {
    const mapped = mapSchema(schema, tag, true, true)

    expect(mapped['$defs']).toEqual({ Unused: { type: 'string', seen: false }, Flag: false })
    expect(mapSchema({ definitions: { X: {} } }, tag, true, true)['definitions']).toEqual({
      X: { seen: false },
    })
  })

  it('keeps non-schema keyword values as they are', () => {
    const odd = { properties: { a: 1 }, items: 'x', oneOf: 3, $defs: 4 }

    expect(mapSchema(odd, (node) => node, true, true)).toEqual(odd)
  })
})
