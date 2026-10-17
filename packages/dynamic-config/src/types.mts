import type { DynamicConfig } from 'valkyries/dynamic-config'

export type DynamicConfigFieldType = 'boolean' | 'number' | 'string'
export type DynamicConfigFieldValue = boolean | number | string
export type DynamicConfigFields = Record<string, DynamicConfigFieldValue>

/** The subset of a valkyries `DynamicConfig` instance this package uses. Fakes may implement it. */
export type DynamicConfigLike = Pick<
  DynamicConfig,
  'key' | 'fieldTypes' | 'defaultFields' | 'waitForInitialization' | 'getFields' | 'setFields'
>

export type DynamicConfigPermission = 'view' | 'update'

export type DynamicConfigAccess = {
  update_roles: string[]
}

export type DynamicConfigFieldMetadata = {
  name: string
  type: DynamicConfigFieldType
  value: DynamicConfigFieldValue
  default_value: DynamicConfigFieldValue | null
  description: string
  min_value?: number | undefined
  max_value?: number | undefined
  max_value_exemption?: string | undefined
  integer?: boolean | undefined
}

export type DynamicConfigFieldDescriptors = Record<
  string,
  Partial<Omit<DynamicConfigFieldMetadata, 'default_value' | 'name' | 'type' | 'value'>>
>

export type DynamicConfigRegistryEntry = {
  namespace: string
  label: string
  description: string
  config: DynamicConfigLike
  access: DynamicConfigAccess
  fields: DynamicConfigFieldDescriptors
  /** Cross-field validator; throws (typically `DynamicConfigValidationError`) to reject. */
  validate?: (next: DynamicConfigFields) => void
}

export type DynamicConfigNamespaceSummary = {
  namespace: string
  label: string
  description: string
  field_count: number
  can_view: boolean
  can_update: boolean
}

export type DynamicConfigNamespace = DynamicConfigNamespaceSummary & {
  config: DynamicConfigFields
  fields: DynamicConfigFieldMetadata[]
}

export type DynamicConfigChangedFields = Record<string, { previous: unknown; next: unknown }>

export type DynamicConfigUpdateResult = {
  namespace: DynamicConfigNamespace
  changed: boolean
}

/** Decides whether `user` may view or update an entry. Application-owned policy. */
export type DynamicConfigAuthorizer<TUser> = (
  user: TUser,
  entry: DynamicConfigRegistryEntry,
  permission: DynamicConfigPermission,
) => boolean | Promise<boolean>
