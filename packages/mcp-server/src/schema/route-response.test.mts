import { describe, expect, it } from 'vitest'

import { assertLocalSchemaRefs } from './local-refs.mts'
import {
  ensureObjectRootSchema,
  inlineSchemaReferences,
  resolveComponentSchema,
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

  it('supports projections, fallback response tables, path normalization, and union object roots', () => {
    const unionBody = {
      anyOf: [
        { type: 'object', properties: { results: { type: 'array' } } },
        { type: 'object', properties: { item: { type: 'string' } } },
      ],
    }
    const responses = {
      'GET:/things/:id#staff': ref('Page'),
    }
    const fallbackResponses = {
      'GET:/things/:id': unionBody,
    }

    expect(
      resolveRouteResponse({ method: 'GET', path: '/things/{id}' }, responses, components, {
        projection: 'staff',
        fallbackResponses,
        normalizePathParams: true,
      }),
    ).toEqual({ type: 'object', properties: { total: { type: 'number' } } })

    expect(
      resolveRouteResponse({ method: 'GET', path: '/things/{id}' }, responses, components, {
        fallbackResponses,
        normalizePathParams: true,
      }),
    ).toEqual({ ...unionBody, type: 'object' })

    expect(() =>
      resolveRouteResponse({ method: 'GET', path: '/missing/{id}' }, responses, components, {
        fallbackResponses,
        normalizePathParams: true,
      }),
    ).toThrow('No checked-in response contract for GET:/missing/:id.')
  })
})

describe('ensureObjectRootSchema', () => {
  it('accepts direct object, all-object anyOf/oneOf, and allOf with an object branch', () => {
    expect(ensureObjectRootSchema({ type: 'object', properties: {} })).toEqual({
      type: 'object',
      properties: {},
    })
    expect(
      ensureObjectRootSchema({
        oneOf: [{ type: 'object', properties: { a: { type: 'string' } } }, { type: 'object' }],
      }),
    ).toMatchObject({ type: 'object' })
    expect(
      ensureObjectRootSchema({
        allOf: [{ description: 'extra' }, { type: 'object', properties: {} }],
      }),
    ).toMatchObject({ type: 'object' })
  })

  it('rejects non-object roots and mixed or empty unions', () => {
    expect(() => ensureObjectRootSchema({ type: 'string' })).toThrow('Schema must be an object')
    expect(() => ensureObjectRootSchema({ anyOf: [] }, 'Response GET:/x')).toThrow(
      'Response GET:/x must be an object',
    )
    expect(() =>
      ensureObjectRootSchema({ anyOf: [{ type: 'object' }, { type: 'array' }] }, 'Response'),
    ).toThrow('Response must be an object')
    expect(() => ensureObjectRootSchema({ allOf: [{ type: 'string' }] })).toThrow(
      'Schema must be an object',
    )
    expect(() => ensureObjectRootSchema({ oneOf: [null] })).toThrow('Schema must be an object')
  })
})

describe('resolveComponentSchema', () => {
  it('inlines a named component and rejects recursive ones', () => {
    const components = {
      Id: { type: 'string' },
      Widget: { type: 'object', properties: { id: ref('Id') } },
      Node: { type: 'object', properties: { next: ref('Node') } },
    }

    expect(resolveComponentSchema('Widget', components)).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
    })
    expect(() => resolveComponentSchema('Node', components)).toThrow(
      'A recursive response contract cannot be nested.',
    )
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
