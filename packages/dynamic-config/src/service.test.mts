import { describe, expect, it, vi } from 'vitest'
import { createRoleAuthorizer } from './authorization.mts'
import { createDynamicConfigAdmin } from './service.mts'
import { createDynamicConfigRegistry } from './registry.mts'
import { fakeConfig, fakeEntry } from './test-helpers.mts'
import { DynamicConfigValidationError } from './errors.mts'

type User = { id: string; roles: string[] }
const admin: User = { id: 'a', roles: ['administrator'] }
const dev: User = { id: 'd', roles: ['developer'] }
const mod: User = { id: 'm', roles: ['moderator'] }
const nobody: User = { id: 'n', roles: [] }

function setup(extra: { validate?: (next: Record<string, unknown>) => void } = {}) {
  const config = fakeConfig(
    { enabled: 'boolean', limit: 'number', mode: 'string' },
    { enabled: false, limit: 5, mode: 'a' },
    { limit: 7 },
  )
  const entry = fakeEntry({ ...extra }, config)
  const recordChange = vi.fn(() => Promise.resolve())
  const readHistory = vi.fn((_user: User, namespace: string) => Promise.resolve([namespace]))
  const admin_ = createDynamicConfigAdmin<User, string>({
    registry: createDynamicConfigRegistry([entry]),
    authorize: createRoleAuthorizer<User>({
      getRoles: (user) => user.roles,
      adminRoles: ['administrator'],
      viewerRoles: ['moderator'],
    }),
    recordChange,
    readHistory,
  })
  return { config, admin: admin_, recordChange, readHistory }
}

describe('createDynamicConfigAdmin', () => {
  it('lists only viewable namespaces with permission flags', async () => {
    const { admin: service } = setup()
    expect(await service.list(nobody)).toEqual([])
    expect(await service.list(mod)).toEqual([
      expect.objectContaining({
        namespace: 'demo',
        can_view: true,
        can_update: false,
        field_count: 3,
      }),
    ])
    expect(await service.list(dev)).toEqual([])
  })

  it('gets a namespace with live values, defaults, and metadata', async () => {
    const { admin: service } = setup()
    expect(await service.get(nobody, 'demo')).toBeNull()
    expect(await service.get(admin, 'missing')).toBeNull()
    const result = await service.get(admin, 'demo')
    expect(result?.config).toEqual({ enabled: false, limit: 7, mode: 'a' })
    expect(result?.fields.find((field) => field.name === 'limit')).toMatchObject({
      type: 'number',
      value: 7,
      default_value: 5,
      min_value: 1,
      max_value: 10,
      integer: true,
      description: 'limit',
    })
    expect(result?.fields.find((field) => field.name === 'enabled')?.description).toBe('Turn it on')
  })

  it('returns null for unauthorized or unknown updates', async () => {
    const { admin: service, recordChange } = setup()
    expect(await service.update(mod, 'demo', { limit: 2 })).toBeNull()
    expect(await service.update(admin, 'missing', { limit: 2 })).toBeNull()
    expect(recordChange).not.toHaveBeenCalled()
  })

  it('records then writes changed fields', async () => {
    const { admin: service, config, recordChange } = setup()
    const result = await service.update(dev, 'demo', { limit: 2, mode: 'b' })
    expect(result?.changed).toBe(true)
    expect(result?.namespace.can_update).toBe(true)
    expect(recordChange).toHaveBeenCalledWith(
      dev,
      'demo',
      { enabled: false, limit: 7, mode: 'a' },
      { enabled: false, limit: 2, mode: 'b' },
    )
    expect(config.stored).toEqual({ limit: 2, mode: 'b' })
  })

  it('does not record or write unchanged values', async () => {
    const { admin: service, config, recordChange } = setup()
    const result = await service.update(admin, 'demo', { limit: 7 })
    expect(result?.changed).toBe(false)
    expect(recordChange).not.toHaveBeenCalled()
    expect(config.stored).toEqual({ limit: 7 })
  })

  it('works without recordChange', async () => {
    const config = fakeConfig({ a: 'boolean' }, { a: false })
    const service = createDynamicConfigAdmin<User>({
      registry: createDynamicConfigRegistry([fakeEntry({ fields: { a: {} } }, config)]),
      authorize: () => true,
    })
    expect((await service.update(admin, 'demo', { a: true }))?.changed).toBe(true)
    expect(await service.history(admin, 'demo')).toEqual([])
  })

  it('rejects invalid input and failing cross-field validators before writing', async () => {
    const reject = (): never => {
      throw new DynamicConfigValidationError('nope')
    }
    const { admin: service, config, recordChange } = setup({ validate: reject })
    await expect(service.update(admin, 'demo', {})).rejects.toThrow('must not be empty')
    await expect(service.update(admin, 'demo', { limit: 99 })).rejects.toThrow('less than or equal')
    await expect(service.update(admin, 'demo', { limit: 2 })).rejects.toThrow('nope')
    expect(recordChange).not.toHaveBeenCalled()
    expect(config.stored).toEqual({ limit: 7 })
  })

  it('reads history only for viewable namespaces', async () => {
    const { admin: service, readHistory } = setup()
    expect(await service.history(nobody, 'demo')).toBeNull()
    expect(await service.history(admin, 'missing')).toBeNull()
    expect(readHistory).not.toHaveBeenCalled()
    expect(await service.history(mod, 'demo')).toEqual(['demo'])
  })

  it('reports a null default_value for fields without defaults', async () => {
    const config = fakeConfig({ a: 'string' }, {}, { a: 'set' })
    const service = createDynamicConfigAdmin<User>({
      registry: createDynamicConfigRegistry([fakeEntry({ fields: { a: {} } }, config)]),
      authorize: () => true,
    })
    const result = await service.get(admin, 'demo')
    expect(result?.fields[0]).toMatchObject({ value: 'set', default_value: null })
  })
})
