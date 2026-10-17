import {
  humanizeFieldName,
  normalizeFieldValue,
  normalizeFields,
  toDynamicConfigFieldType,
} from './fields.mts'
import type {
  DynamicConfigNamespace,
  DynamicConfigNamespaceSummary,
  DynamicConfigRegistryEntry,
} from './types.mts'

export type NamespacePermissions = { can_view: boolean; can_update: boolean }

export function toNamespaceSummary(
  entry: DynamicConfigRegistryEntry,
  permissions: NamespacePermissions,
): DynamicConfigNamespaceSummary {
  return {
    namespace: entry.namespace,
    label: entry.label,
    description: entry.description,
    field_count: Object.keys(entry.config.fieldTypes).length,
    ...permissions,
  }
}

/** Projects an entry and its live values for admin display. Call after `waitForInitialization`. */
export function toNamespace(
  entry: DynamicConfigRegistryEntry,
  permissions: NamespacePermissions,
): DynamicConfigNamespace {
  const config = normalizeFields(entry, entry.config.getFields())
  return {
    ...toNamespaceSummary(entry, permissions),
    config,
    fields: Object.entries(entry.config.fieldTypes).map(([name, rawType]) => {
      const defaultValue = entry.config.defaultFields[name]
      const metadata = entry.fields[name]
      return {
        name,
        type: toDynamicConfigFieldType(name, rawType),
        value: config[name]!,
        default_value:
          defaultValue === undefined ? null : normalizeFieldValue(name, rawType, defaultValue),
        description: metadata?.description ?? humanizeFieldName(name),
        min_value: metadata?.minValue,
        max_value: metadata?.maxValue,
        max_value_exemption: metadata?.maxValueExemption,
        integer: metadata?.integer,
      }
    }),
  }
}
