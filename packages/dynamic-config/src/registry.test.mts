import { describe, expect, it } from 'vitest'
import { createRoleAuthorizer } from './authorization.mts'
import { defineDynamicConfigNamespace, withMaxValueExemption } from './descriptor.mts'
import { createDynamicConfigRegistry } from './registry.mts'
import { fakeConfig, fakeEntry } from './test-helpers.mts'

describe('createDynamicConfigRegistry', () => {
  it('looks up entries and rejects duplicate namespaces', () => {
    const entry = fakeEntry()
    const registry = createDynamicConfigRegistry([entry])
    expect(registry.get('demo')).toBe(entry)
    expect(registry.get('other')).toBeNull()
    expect(registry.entries).toEqual([entry])
    expect(() => createDynamicConfigRegistry([entry, entry])).toThrow('Duplicate')
  })
})

describe('defineDynamicConfigNamespace', () => {
  const config = fakeConfig({ a: 'number', b: 'number' }, { a: 1, b: 2 })
  const base = {
    namespace: 'n',
    label: 'N',
    description: 'd',
    config,
    access: { update_roles: [] },
  }

  it('accepts matching metadata', () => {
    expect(() => defineDynamicConfigNamespace({ ...base, fields: { a: {}, b: {} } })).not.toThrow()
  })

  it('reports missing and extra metadata', () => {
    expect(() => defineDynamicConfigNamespace({ ...base, fields: { a: {} } })).toThrow(
      'metadata drift for n: missing metadata: b',
    )
    expect(() =>
      defineDynamicConfigNamespace({ ...base, fields: { a: {}, b: {}, c: {} } }),
    ).toThrow('extra metadata: c')
    expect(() => defineDynamicConfigNamespace({ ...base, fields: { c: {} } })).toThrow(
      'missing metadata: a, b; extra metadata: c',
    )
  })
})

describe('withMaxValueExemption', () => {
  it('exempts unbounded fields except the named ones', () => {
    expect(withMaxValueExemption({ a: { max_value: 3 }, b: {}, c: {} }, 'why', ['c'])).toEqual({
      a: { max_value: 3 },
      b: { max_value_exemption: 'why' },
      c: {},
    })
    expect(withMaxValueExemption({ a: {} }, 'why')).toEqual({ a: { max_value_exemption: 'why' } })
  })
})

describe('createRoleAuthorizer', () => {
  const entry = fakeEntry()
  const authorize = createRoleAuthorizer<string[]>({
    getRoles: (roles) => roles,
    adminRoles: ['administrator'],
    viewerRoles: ['moderator'],
  })

  it('applies admin, viewer, and per-entry update roles', () => {
    expect(authorize(['administrator'], entry, 'update')).toBe(true)
    expect(authorize(['moderator'], entry, 'view')).toBe(true)
    expect(authorize(['moderator'], entry, 'update')).toBe(false)
    expect(authorize(['developer'], entry, 'update')).toBe(true)
    expect(authorize(['developer'], entry, 'view')).toBe(false)
    expect(authorize([], entry, 'view')).toBe(false)
  })
})
