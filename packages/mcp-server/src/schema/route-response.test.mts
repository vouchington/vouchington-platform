import { describe, expect, it } from 'vitest'

import { assertLocalSchemaRefs } from '../test-helpers.mts'
import {
  inlineSchemaReferences,
  resolveRouteResponse,
  routePropertySchema,
  successResultSchema,
} from './route-response.mts'

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` })
const ENDPOINT = { method: 'GET', path: '/things' } as const

describe('inlineSchemaReferences', () => {
  it('inlines nested references and keeps the keywords written beside a reference', () => {
    const components = {
      Id: { type: 'string' },
      Thing: { type: 'object', properties: { id: ref('Id') } },
    }

    expect(
      inlineSchemaReferences(
        { anyOf: [{ ...ref('Thing'), description: 'A thing' }, { type: 'null' }] },
        components,
      ),
    ).toEqual({
      anyOf: [
        { type: 'object', properties: { id: { type: 'string' } }, description: 'A thing' },
        { type: 'null' },
      ],
    })
  })

  it('keeps a self-referencing component as a reference into root $defs', () => {
    const node = {
      type: 'object',
      properties: {
        parent: { anyOf: [ref('Node'), { type: 'null' }] },
        children: { type: 'array', items: ref('Node') },
      },
    }
    const resolved = {
      type: 'object',
      properties: {
        parent: { anyOf: [{ $ref: '#/$defs/Node' }, { type: 'null' }] },
        children: { type: 'array', items: { $ref: '#/$defs/Node' } },
      },
    }

    const inlined = inlineSchemaReferences(ref('Node'), { Node: node })

    expect(inlined).toEqual({ ...resolved, $defs: { Node: resolved } })
    assertLocalSchemaRefs(inlined)
  })

  it('terminates on mutually recursive components', () => {
    const components = {
      A: { type: 'object', properties: { b: ref('B') } },
      B: { type: 'object', properties: { a: ref('A') } },
    }
    const inlined = inlineSchemaReferences(ref('A'), components) as { $defs: object }

    expect(Object.keys(inlined.$defs)).toEqual(['A'])
    expect(JSON.stringify(inlined)).not.toContain('#/components')
  })

  it('passes scalars and arrays through', () => {
    expect(inlineSchemaReferences({ enum: ['a', 1, null], const: 2 }, {})).toEqual({
      enum: ['a', 1, null],
      const: 2,
    })
  })

  it.each([ref('Missing'), { $ref: '#/definitions/Thing' }, ref('constructor'), ref('__proto__')])(
    'rejects the unresolvable reference %j',
    (schema) => {
      expect(() => inlineSchemaReferences(schema, { Thing: { type: 'object' } })).toThrow(
        'Unresolvable response contract reference',
      )
    },
  )
})

describe('resolveRouteResponse', () => {
  const components = { Page: { type: 'object', properties: { total: { type: 'number' } } } }

  it('returns the self-contained object schema for a route', () => {
    expect(resolveRouteResponse(ENDPOINT, { 'GET:/things': ref('Page') }, components)).toEqual({
      type: 'object',
      properties: { total: { type: 'number' } },
    })
  })

  it('names the route when it has no response contract, with the injected hint', () => {
    expect(() => resolveRouteResponse(ENDPOINT, {}, components)).toThrow(
      'No checked-in response contract for GET:/things.',
    )
    expect(() =>
      resolveRouteResponse(ENDPOINT, {}, components, { missingContractHint: 'Regenerate it.' }),
    ).toThrow('No checked-in response contract for GET:/things. Regenerate it.')
  })

  it('rejects a route whose response is not an object, which MCP requires', () => {
    expect(() =>
      resolveRouteResponse(
        ENDPOINT,
        { 'GET:/things': { type: 'array', items: { type: 'string' } } },
        components,
      ),
    ).toThrow('is not an object')
  })
})

describe('routePropertySchema', () => {
  const body = { type: 'object', properties: { results: { type: 'array' } } } as const

  it('returns one property of the body', () => {
    expect(routePropertySchema(body, 'results')).toEqual({ type: 'array' })
  })

  it('rejects a property the contract does not have', () => {
    expect(() => routePropertySchema(body, 'page_info')).toThrow('no "page_info" property')
    expect(() => routePropertySchema({ type: 'object' }, 'page_info')).toThrow('no "page_info"')
  })

  it('rejects a recursive body, whose $defs cannot move with one property', () => {
    expect(() => routePropertySchema({ ...body, $defs: {} }, 'results')).toThrow('recursive')
  })
})

describe('successResultSchema', () => {
  it('wraps the body in the success envelope the list tools return', () => {
    expect(successResultSchema({ type: 'object', properties: {} })).toEqual({
      type: 'object',
      properties: { success: { const: true }, result: { type: 'object', properties: {} } },
      required: ['success', 'result'],
      additionalProperties: false,
    })
  })

  it('hoists $defs to the root of the envelope so their references still resolve', () => {
    expect(
      successResultSchema({ type: 'object', properties: {}, $defs: { Node: { type: 'object' } } }),
    ).toMatchObject({
      properties: { result: { type: 'object', properties: {} } },
      $defs: { Node: { type: 'object' } },
    })
  })
})
