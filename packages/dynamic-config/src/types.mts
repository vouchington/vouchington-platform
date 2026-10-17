import type { DynamicConfigField, DynamicConfigFieldType } from 'valkyries'
import type {
  DynamicConfig,
  DynamicConfigNamespaceDefinition,
  DynamicConfigRegistry,
} from 'valkyries/dynamic-config'

export type DynamicConfigFields = Record<string, DynamicConfigField>

/** The subset of a valkyries `DynamicConfig` instance this package uses. Fakes may implement it. */
export type DynamicConfigLike = Pick<
  DynamicConfig,
  'key' | 'fieldTypes' | 'defaultFields' | 'waitForInitialization' | 'getFields' | 'setFields'
>

export type DynamicConfigPermission = 'view' | 'update'

export type DynamicConfigAccess = {
  update_roles: string[]
}

/**
 * A valkyries namespace definition plus the admin-facing label, description, and access policy.
 * Field rules are valkyries' camelCase `DynamicConfigFieldRules`.
 */
export type DynamicConfigRegistryEntry = DynamicConfigNamespaceDefinition<DynamicConfigLike> & {
  label: string
  description: string
  access: DynamicConfigAccess
}

/** A valkyries registry of admin entries (`createDynamicConfigRegistry<DynamicConfigRegistryEntry>`). */
export type AdminDynamicConfigRegistry = DynamicConfigRegistry<DynamicConfigRegistryEntry>

/** Admin output for one field (snake_case). */
export type DynamicConfigFieldMetadata = {
  name: string
  type: DynamicConfigFieldType
  value: DynamicConfigField
  default_value: DynamicConfigField | null
  description: string
  min_value?: number | undefined
  max_value?: number | undefined
  max_value_exemption?: string | undefined
  integer?: boolean | undefined
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
