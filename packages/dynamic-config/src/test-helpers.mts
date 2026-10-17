import type { DynamicConfigField } from 'valkyries'
import { defineDynamicConfigNamespace } from 'valkyries/dynamic-config'
import type {
  DynamicConfigFields,
  DynamicConfigLike,
  DynamicConfigRegistryEntry,
} from './types.mts'

export type FakeConfig = DynamicConfigLike & { stored: Record<string, DynamicConfigField> }

export function fakeConfig(
  fieldTypes: Record<string, 'boolean' | 'number' | 'string'>,
  defaultFields: DynamicConfigFields,
  stored: Record<string, DynamicConfigField> = {},
): FakeConfig {
  const config: FakeConfig = {
    key: 'fake',
    fieldTypes,
    defaultFields,
    stored,
    waitForInitialization: () => Promise.resolve(),
    getFields: () => ({ ...config.stored }),
    setFields: (fields) => {
      Object.assign(config.stored, fields)
      return Promise.resolve()
    },
  }
  return config
}

export function fakeEntry(
  overrides: Partial<DynamicConfigRegistryEntry> = {},
  config: FakeConfig = fakeConfig(
    { enabled: 'boolean', limit: 'number', mode: 'string' },
    { enabled: false, limit: 5, mode: 'a' },
  ),
): DynamicConfigRegistryEntry {
  return defineDynamicConfigNamespace<DynamicConfigRegistryEntry>({
    namespace: 'demo',
    label: 'Demo',
    description: 'Demo namespace',
    config,
    access: { update_roles: ['developer'] },
    fields: {
      enabled: { description: 'Turn it on' },
      limit: { minValue: 1, maxValue: 10, integer: true },
      mode: {},
    },
    ...overrides,
  })
}
