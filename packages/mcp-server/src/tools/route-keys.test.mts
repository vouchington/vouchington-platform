import { describe, expect, it } from 'vitest'

import type { McpToolMeta, ToolApiEndpoint } from '../types.mts'
import { toRouteKey, toolRouteCharges } from './route-keys.mts'

const CREATE: ToolApiEndpoint = { method: 'POST', path: '/api/v1/things' }
const REMOVE: ToolApiEndpoint = { method: 'DELETE', path: '/api/v1/things/:id' }

const metaOf = (extra: Partial<Pick<McpToolMeta, 'api' | 'selectApi'>>) =>
  ({ api: null, ...extra }) as Pick<McpToolMeta, 'api' | 'selectApi'>

describe('toRouteKey', () => {
  it.each([
    [{ method: 'POST', path: '/api/v1/reports' }, 'POST:/api/v1/reports'],
    [{ method: 'PATCH', path: '/api/v1/posts/:idOrSlug' }, 'PATCH:/api/v1/posts/:idOrSlug'],
    [
      { method: 'DELETE', path: '/api/v1/admin/stories/{id}/items/{itemId}' },
      'DELETE:/api/v1/admin/stories/:id/items/:itemId',
    ],
  ] as const)('normalizes %j to %s', (endpoint, expected) => {
    expect(toRouteKey(endpoint)).toBe(expected)
  })
})

describe('toolRouteCharges', () => {
  it('returns no charges when metadata or api is absent', () => {
    expect(toolRouteCharges(undefined, {})).toEqual([])
    expect(toolRouteCharges(metaOf({ api: null }), {})).toEqual([])
  })

  it('deduplicates unweighted routes after placeholder normalization', () => {
    const api: ToolApiEndpoint[] = [
      CREATE,
      REMOVE,
      { method: 'DELETE', path: '/api/v1/things/{id}' },
    ]

    expect(toolRouteCharges(metaOf({ api }), {})).toEqual([
      { routeKeys: ['POST:/api/v1/things', 'DELETE:/api/v1/things/:id'], weight: 1 },
    ])
  })

  it('uses selectApi when present', () => {
    const meta = metaOf({
      api: [CREATE, REMOVE],
      selectApi: (args) => (args['kind'] === 'remove' ? [REMOVE] : []),
    })

    expect(toolRouteCharges(meta, { kind: 'remove' })).toEqual([
      { routeKeys: ['DELETE:/api/v1/things/:id'], weight: 1 },
    ])
    expect(toolRouteCharges(meta, { kind: 'other' })).toEqual([])
  })

  it('emits per-route charges for positive safe-integer weights and keeps the largest weight', () => {
    const meta = metaOf({
      api: [CREATE, REMOVE],
      selectApi: () => [
        CREATE,
        { method: 'PUT', path: '/api/v1/items/{id}', weight: 2 },
        { method: 'PUT', path: '/api/v1/items/:id', weight: 5 },
        { method: 'PUT', path: '/api/v1/items/:id', weight: 3 },
        { method: 'PATCH', path: '/api/v1/items/:id', weight: 0 },
        { method: 'DELETE', path: '/api/v1/items/:id', weight: 1.5 },
      ],
    })

    expect(toolRouteCharges(meta, {})).toEqual([
      {
        routeKeys: ['POST:/api/v1/things', 'PATCH:/api/v1/items/:id', 'DELETE:/api/v1/items/:id'],
        weight: 1,
      },
      { routeKeys: ['PUT:/api/v1/items/:id'], weight: 5 },
    ])
  })
})
