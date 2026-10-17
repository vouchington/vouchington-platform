import type { DynamicConfigField, DynamicConfigFieldType } from 'valkyries'
import type { DynamicConfigFields, DynamicConfigRegistryEntry } from './types.mts'

/** Reads every declared field, falling back to defaults, and verifies the runtime types. */
export function normalizeFields(
  entry: DynamicConfigRegistryEntry,
  rawFields: Record<string, unknown>,
): DynamicConfigFields {
  const fields: DynamicConfigFields = {}
  for (const [name, type] of Object.entries(entry.config.fieldTypes)) {
    fields[name] = normalizeFieldValue(
      name,
      type,
      rawFields[name] ?? entry.config.defaultFields[name],
    )
  }
  return fields
}

export function normalizeFieldValue(
  name: string,
  rawType: string,
  value: unknown,
): DynamicConfigField {
  const type = toDynamicConfigFieldType(name, rawType)
  if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Invalid number config field ${name}`)
    }
    return value
  }
  if (typeof value !== type) throw new Error(`Invalid ${type} config field ${name}`)
  return value as boolean | string
}

export function toDynamicConfigFieldType(name: string, rawType: string): DynamicConfigFieldType {
  if (rawType === 'boolean' || rawType === 'number' || rawType === 'string') return rawType
  throw new Error(`Unsupported dynamic config field type for ${name}: ${rawType}`)
}

export function humanizeFieldName(name: string): string {
  return name.replaceAll('_', ' ')
}
