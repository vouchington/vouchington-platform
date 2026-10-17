import { DynamicConfigValidationError } from './errors.mts'
import type {
  DynamicConfigChangedFields,
  DynamicConfigFields,
  DynamicConfigFieldType,
  DynamicConfigFieldValue,
  DynamicConfigRegistryEntry,
} from './types.mts'

export function assertPlainChanges(changes: Record<string, unknown>): void {
  if (!changes || typeof changes !== 'object' || Array.isArray(changes)) {
    throw new DynamicConfigValidationError('Missing config object')
  }
  if (Object.keys(changes).length === 0) {
    throw new DynamicConfigValidationError('Config object must not be empty')
  }
}

/** Type-checks and bounds-checks requested changes against the entry's field types and metadata. */
export function validateChanges(
  entry: DynamicConfigRegistryEntry,
  previous: DynamicConfigFields,
  changes: Record<string, unknown>,
): DynamicConfigFields {
  const validated: DynamicConfigFields = {}
  for (const [name, value] of Object.entries(changes)) {
    const fieldType = entry.config.fieldTypes[name]
    if (!fieldType || !Object.hasOwn(previous, name)) {
      throw new DynamicConfigValidationError(`Unknown config field: ${name}`)
    }
    if (fieldType === 'boolean' || fieldType === 'string') {
      if (typeof value !== fieldType) {
        throw new DynamicConfigValidationError(
          `Field ${name} must be a ${fieldType === 'boolean' ? 'boolean' : 'string'}`,
        )
      }
      validated[name] = value as boolean | string
      continue
    }
    validated[name] = validateNumber(entry, name, value)
  }
  return validated
}

function validateNumber(entry: DynamicConfigRegistryEntry, name: string, value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DynamicConfigValidationError(`Field ${name} must be a finite number`)
  }
  const metadata = entry.fields[name]
  if (metadata?.integer && !Number.isSafeInteger(value)) {
    throw new DynamicConfigValidationError(`Field ${name} must be a safe integer`)
  }
  if (metadata?.min_value !== undefined && value < metadata.min_value) {
    throw new DynamicConfigValidationError(
      `Field ${name} must be greater than or equal to ${metadata.min_value}`,
    )
  }
  if (metadata?.max_value !== undefined && value > metadata.max_value) {
    throw new DynamicConfigValidationError(
      `Field ${name} must be less than or equal to ${metadata.max_value}`,
    )
  }
  return value
}

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
): DynamicConfigFieldValue {
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

/** Shallow diff of two field snapshots; absent keys read as `undefined`. */
export function getChangedFields(
  previousFields: Record<string, unknown> | null | undefined,
  nextFields: Record<string, unknown> | null | undefined,
): DynamicConfigChangedFields {
  const previous = previousFields ?? {}
  const next = nextFields ?? {}
  const changed: DynamicConfigChangedFields = {}
  for (const key of new Set([...Object.keys(previous), ...Object.keys(next)])) {
    if (previous[key] !== next[key]) changed[key] = { previous: previous[key], next: next[key] }
  }
  return changed
}
