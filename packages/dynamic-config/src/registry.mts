import type { DynamicConfigRegistryEntry } from './types.mts'

export type DynamicConfigRegistry = {
  readonly entries: readonly DynamicConfigRegistryEntry[]
  get(namespace: string): DynamicConfigRegistryEntry | null
}

/** Builds a lookup over injected entries. Namespaces must be unique. */
export function createDynamicConfigRegistry(
  entries: readonly DynamicConfigRegistryEntry[],
): DynamicConfigRegistry {
  const byNamespace = new Map<string, DynamicConfigRegistryEntry>()
  for (const entry of entries) {
    if (byNamespace.has(entry.namespace)) {
      throw new Error(`Duplicate dynamic config namespace: ${entry.namespace}`)
    }
    byNamespace.set(entry.namespace, entry)
  }
  return {
    entries: [...entries],
    get: (namespace) => byNamespace.get(namespace) ?? null,
  }
}
