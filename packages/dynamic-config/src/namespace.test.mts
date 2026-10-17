import { describe, expect, it } from 'vitest'
import { createRoleAuthorizer } from './authorization.mts'
import { toAdminNamespaceSummary, toAdminNamespaceView } from './namespace.mts'
import { fakeConfig, fakeEntry } from './test-helpers.mts'

const permissions = { can_view: true, can_update: false }

describe('toAdminNamespaceSummary', () => {
  it('projects snake_case summary fields', () => {
    expect(toAdminNamespaceSummary(fakeEntry(), permissions)).toEqual({
      namespace: 'demo',
      label: 'Demo',
      description: 'Demo namespace',
      field_count: 3,
      can_view: true,
      can_update: false,
    })
  })
})

describe('toAdminNamespaceView', () => {
  it('maps camelCase rules to snake_case with live values and defaults', () => {
    const config = fakeConfig(
      { enabled: 'boolean', limit: 'number', mode: 'string' },
      { enabled: false, limit: 5, mode: 'a' },
      { limit: 7 },
    )
    const view = toAdminNamespaceView(fakeEntry({}, config), permissions)
    expect(view.config).toEqual({ enabled: false, limit: 7, mode: 'a' })
    expect(view.fields.find((field) => field.name === 'limit')).toEqual({
      name: 'limit',
      type: 'number',
      value: 7,
      default_value: 5,
      description: 'limit',
      min_value: 1,
      max_value: 10,
      max_value_exemption: undefined,
      integer: true,
    })
    expect(view.fields.find((field) => field.name === 'enabled')?.description).toBe('Turn it on')
  })

  it('reports exemptions and a null default_value for fields without defaults', () => {
    const config = fakeConfig({ a: 'string' }, {}, { a: 'set' })
    const entry = fakeEntry({ fields: { a: { maxValueExemption: 'free text' } } }, config)
    expect(toAdminNamespaceView(entry, permissions).fields[0]).toMatchObject({
      value: 'set',
      default_value: null,
      max_value_exemption: 'free text',
    })
  })
})

describe('createRoleAuthorizer', () => {
  const authorize = createRoleAuthorizer<{ roles: string[] }>({
    getRoles: (user) => user.roles,
    adminRoles: ['administrator'],
    viewerRoles: ['moderator'],
  })
  const entry = fakeEntry()

  it('lets admins do everything', () => {
    expect(authorize({ roles: ['administrator'] }, entry, 'update')).toBe(true)
  })

  it('lets viewers view but not update', () => {
    expect(authorize({ roles: ['moderator'] }, entry, 'view')).toBe(true)
    expect(authorize({ roles: ['moderator'] }, entry, 'update')).toBe(false)
  })

  it('uses entry.access.update_roles for updates', () => {
    expect(authorize({ roles: ['developer'] }, entry, 'update')).toBe(true)
    expect(authorize({ roles: ['developer'] }, entry, 'view')).toBe(false)
    expect(authorize({ roles: [] }, entry, 'update')).toBe(false)
  })
})
