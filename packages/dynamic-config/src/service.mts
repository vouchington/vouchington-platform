import { validateDynamicConfigUpdate } from 'valkyries/dynamic-config'
import { normalizeFields } from './fields.mts'
import { toNamespace, toNamespaceSummary } from './namespace.mts'
import type {
  AdminDynamicConfigRegistry,
  DynamicConfigAuthorizer,
  DynamicConfigFields,
  DynamicConfigNamespace,
  DynamicConfigNamespaceSummary,
  DynamicConfigRegistryEntry,
  DynamicConfigUpdateResult,
} from './types.mts'

export type DynamicConfigAdminOptions<TUser, THistory = never> = {
  registry: AdminDynamicConfigRegistry
  authorize: DynamicConfigAuthorizer<TUser>
  /**
   * Persists an audit record. Awaited after validation and before the config is written, so a
   * failing recorder aborts the update. Only invoked when a value actually changes.
   */
  recordChange?: (
    user: TUser,
    namespace: string,
    previous: DynamicConfigFields,
    next: DynamicConfigFields,
  ) => Promise<void>
  /** Reads application-owned history for a namespace the user is allowed to view. */
  readHistory?: (user: TUser, namespace: string) => Promise<THistory[]>
}

export type DynamicConfigAdmin<TUser, THistory = never> = {
  list(user: TUser): Promise<DynamicConfigNamespaceSummary[]>
  get(user: TUser, namespace: string): Promise<DynamicConfigNamespace | null>
  update(
    user: TUser,
    namespace: string,
    changes: unknown,
  ): Promise<DynamicConfigUpdateResult | null>
  history(user: TUser, namespace: string): Promise<THistory[] | null>
}

/**
 * Admin operations over an injected registry. Unknown namespaces and unauthorized callers are
 * indistinguishable: both return `null`.
 */
export function createDynamicConfigAdmin<TUser, THistory = never>(
  options: DynamicConfigAdminOptions<TUser, THistory>,
): DynamicConfigAdmin<TUser, THistory> {
  const { registry, authorize } = options

  async function permissions(user: TUser, entry: DynamicConfigRegistryEntry) {
    const [can_view, can_update] = await Promise.all([
      authorize(user, entry, 'view'),
      authorize(user, entry, 'update'),
    ])
    return { can_view, can_update }
  }

  async function authorized(user: TUser, namespace: string, permission: 'view' | 'update') {
    const entry = registry.get(namespace)
    return entry && (await authorize(user, entry, permission)) ? entry : null
  }

  return {
    async list(user) {
      const summaries = await Promise.all(
        registry.entries.map(async (entry) =>
          toNamespaceSummary(entry, await permissions(user, entry)),
        ),
      )
      return summaries.filter((summary) => summary.can_view)
    },

    async get(user, namespace) {
      const entry = await authorized(user, namespace, 'view')
      if (!entry) return null
      await entry.config.waitForInitialization()
      return toNamespace(entry, await permissions(user, entry))
    },

    async update(user, namespace, changes) {
      const entry = await authorized(user, namespace, 'update')
      if (!entry) return null

      await entry.config.waitForInitialization()
      const previous = normalizeFields(entry, entry.config.getFields())
      const result = validateDynamicConfigUpdate(entry, previous, changes)
      const { changed } = result
      if (changed) {
        await options.recordChange?.(user, entry.namespace, previous, result.next)
        await entry.config.setFields(result.changes)
      }
      return { changed, namespace: toNamespace(entry, await permissions(user, entry)) }
    },

    async history(user, namespace) {
      const entry = await authorized(user, namespace, 'view')
      if (!entry) return null
      return (await options.readHistory?.(user, entry.namespace)) ?? []
    },
  }
}
