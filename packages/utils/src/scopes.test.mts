import { describe, expect, it } from 'vitest'
import { createScopeCatalog } from './scopes.mts'

const definitions = {
  'article:read': { audience: 'reader', surfaces: ['key', 'oauth'] },
  'article:write': {
    audience: 'reader',
    surfaces: ['oauth'],
    requires: ['article:read'],
  },
  'account:read': { audience: 'account', surfaces: ['key', 'oauth'] },
  'bundle:read': {
    audience: 'reader',
    surfaces: ['oauth'],
    covers: ['article:read'],
  },
  'bundle:all': {
    audience: 'reader',
    surfaces: ['oauth'],
    covers: ['bundle:read', 'article:read'],
  },
}

const catalog = createScopeCatalog(definitions)
const options = { surface: 'oauth', allowMixedAudiences: false }

describe('createScopeCatalog', () => {
  it('validates and sorts caller-defined scopes with audiences and surfaces', () => {
    expect(catalog.validateScopeSet(['article:read', 'article:write'], options)).toEqual({
      valid: true,
      scopes: ['article:read', 'article:write'],
      audiences: ['reader'],
    })
    expect(catalog.listScopesForAudience('reader', 'key')).toEqual(['article:read'])
    expect(catalog.listScopesForAudience('missing', 'oauth')).toEqual([])
  })

  it('rejects empty, unknown, duplicate, unsupported, incomplete, and mixed sets', () => {
    expect(catalog.validateScopeSet([], options)).toEqual({ valid: false, code: 'empty-scope-set' })
    expect(catalog.validateScopeSet(['unknown'], options)).toEqual({
      valid: false,
      code: 'unknown-scope',
      scope: 'unknown',
    })
    expect(catalog.validateScopeSet(['article:read', 'article:read'], options)).toEqual({
      valid: false,
      code: 'duplicate-scope',
      scope: 'article:read',
    })
    expect(catalog.validateScopeSet(['article:write'], { ...options, surface: 'key' })).toEqual({
      valid: false,
      code: 'unsupported-surface',
      scope: 'article:write',
    })
    expect(catalog.validateScopeSet(['article:write'], options)).toEqual({
      valid: false,
      code: 'missing-prerequisite',
      scope: 'article:write',
      requiredScope: 'article:read',
    })
    expect(catalog.validateScopeSet(['article:read', 'account:read'], options)).toEqual({
      valid: false,
      code: 'mixed-audiences',
    })
    expect(
      catalog.validateScopeSet(['account:read', 'article:read'], {
        ...options,
        allowMixedAudiences: true,
      }),
    ).toEqual({
      valid: true,
      scopes: ['account:read', 'article:read'],
      audiences: ['account', 'reader'],
    })
  })

  it('expands transitive prerequisites, deduplicates, and rejects unknown scopes', () => {
    expect(catalog.expandPrerequisites(['article:read'])).toEqual(['article:read'])
    const graph = createScopeCatalog({
      read: { audience: 'user', surfaces: ['key'] },
      write: { audience: 'user', surfaces: ['key'], requires: ['read'] },
      admin: { audience: 'user', surfaces: ['key'], requires: ['write'] },
    })
    expect(graph.expandPrerequisites(['admin', 'read'])).toEqual(['admin', 'read', 'write'])
    expect(
      graph.validateScopeSet(graph.expandPrerequisites(['admin']), {
        surface: 'key',
        allowMixedAudiences: false,
      }).valid,
    ).toBe(true)
    expect(() => graph.expandPrerequisites(['missing'])).toThrow('Unknown scope')
  })

  it('computes exact and transitive coverage using only caller-declared edges', () => {
    expect(catalog.hasScope(['article:read'], 'article:read')).toBe(true)
    expect(catalog.hasScope(['article:read'], 'article:write')).toBe(false)
    expect(catalog.hasScope(['bundle:all'], 'article:read')).toBe(true)
    expect(catalog.hasScope(['bundle:read'], 'account:read')).toBe(false)
    expect(catalog.hasScope(['article:write'], 'account:read')).toBe(false)
    expect(
      catalog.hasEveryScope(['bundle:all', 'account:read'], ['article:read', 'account:read']),
    ).toBe(true)
    expect(catalog.hasEveryScope(['bundle:all'], ['article:read', 'account:read'])).toBe(false)
    expect(() => catalog.hasScope([], 'unknown')).toThrow('Unknown scope')
    expect(() => catalog.hasScope(['unknown'], 'article:read')).toThrow('Unknown scope')
  })

  it('rejects dangling edges and cycles in either graph', () => {
    expect(() =>
      createScopeCatalog({ a: { audience: 'x', surfaces: ['key'], requires: ['missing'] } }),
    ).toThrow(RangeError)
    expect(() =>
      createScopeCatalog({ a: { audience: 'x', surfaces: ['key'], covers: ['missing'] } }),
    ).toThrow(RangeError)
    expect(() =>
      createScopeCatalog({
        a: { audience: 'x', surfaces: ['key'], requires: ['b'] },
        b: { audience: 'x', surfaces: ['key'], requires: ['a'] },
      }),
    ).toThrow('cycle')
    expect(() =>
      createScopeCatalog({ a: { audience: 'x', surfaces: ['key'], covers: ['a'] } }),
    ).toThrow('cycle')
  })

  it('rejects malformed catalog entries and edges', () => {
    for (const definition of [
      null,
      { audience: '', surfaces: ['key'] },
      { audience: 'x', surfaces: [] },
      { audience: 'x', surfaces: [''] },
      { audience: 'x', surfaces: ['key'], requires: [null] },
      { audience: 'x', surfaces: ['key'], covers: 'bad' },
    ]) {
      expect(() => createScopeCatalog({ a: definition } as never)).toThrow(TypeError)
    }
    expect(() => createScopeCatalog({ '': { audience: 'x', surfaces: ['key'] } })).toThrow(
      TypeError,
    )
  })

  it('takes a snapshot of the caller catalog', () => {
    const input = {
      a: { audience: 'x', surfaces: ['key'], covers: ['b'] },
      b: { audience: 'x', surfaces: ['key'] },
    }
    const snapshot = createScopeCatalog(input)
    input.a.covers.length = 0
    expect(snapshot.hasScope(['a'], 'b')).toBe(true)
  })

  it('accepts a scope without graph edges', () => {
    expect(catalog.validateScopeSet(['article:read'], options)).toEqual({
      valid: true,
      scopes: ['article:read'],
      audiences: ['reader'],
    })
  })
})
