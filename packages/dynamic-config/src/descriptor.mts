import type { DynamicConfigRegistryEntry } from './types.mts'

/**
 * Declares a registry entry and fails fast when field metadata drifts from the runtime
 * `fieldTypes` of the underlying dynamic config.
 */
export function defineDynamicConfigNamespace(
  descriptor: DynamicConfigRegistryEntry,
): DynamicConfigRegistryEntry {
  const runtimeFields = Object.keys(descriptor.config.fieldTypes)
  const metadataFields = Object.keys(descriptor.fields)
  const missing = runtimeFields.filter((name) => !Object.hasOwn(descriptor.fields, name))
  const extra = metadataFields.filter((name) => !Object.hasOwn(descriptor.config.fieldTypes, name))

  if (missing.length > 0 || extra.length > 0) {
    const details = [
      missing.length > 0 ? `missing metadata: ${missing.join(', ')}` : null,
      extra.length > 0 ? `extra metadata: ${extra.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('; ')
    throw new Error(`DynamicConfig metadata drift for ${descriptor.namespace}: ${details}`)
  }
  return descriptor
}

/** Marks every field without a `max_value` as intentionally unbounded, except the named ones. */
export function withMaxValueExemption<T extends DynamicConfigRegistryEntry['fields']>(
  fields: T,
  reason: string,
  except: readonly string[] = [],
): T {
  return Object.fromEntries(
    Object.entries(fields).map(([name, metadata]) => [
      name,
      metadata.max_value === undefined && !except.includes(name)
        ? { ...metadata, max_value_exemption: reason }
        : metadata,
    ]),
  ) as T
}
