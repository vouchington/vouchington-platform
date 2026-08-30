import {
  createTypedEntityEngine,
  type HostnameAssociation,
  type HostnameClaim,
  type MergeInput,
  type TypedEntityCatalog,
  type TypedEntityChange,
  type TypedEntityEngineOptions,
  type TypedEntityTransaction,
} from './index.mts'

export type EntityType = 'group' | 'place'
export type Entity = { readonly id: string; readonly slug: string; readonly type: EntityType }
export type Context = { readonly actor: string }
type State = {
  aliases: Map<string, string>
  associations: Map<string, HostnameAssociation>
  claims: Map<string, HostnameClaim>
  merges: MergeInput[]
  parents: Map<string, Set<string>>
}

export function fixture(
  overrides: Partial<TypedEntityEngineOptions<EntityType, Entity, Context>> = {},
) {
  const entities = new Map<string, Entity>([
    ['one', { id: 'one', slug: 'First', type: 'group' }],
    ['two', { id: 'two', slug: 'second', type: 'group' }],
    ['three', { id: 'three', slug: 'third', type: 'group' }],
    ['place', { id: 'place', slug: 'somewhere', type: 'place' }],
  ])
  let state: State = emptyState()
  let transactions = 0
  let hostnameLockHook:
    | ((hostnames: readonly string[], claims: Map<string, HostnameClaim>) => void)
    | undefined
  const locks: string[] = []
  const audits: TypedEntityChange[] = []
  const commits: (readonly TypedEntityChange[])[] = []
  const store = {
    async transact<TResult>(
      _context: Context,
      operation: (transaction: TypedEntityTransaction<EntityType, Entity>) => Promise<TResult>,
    ): Promise<TResult> {
      transactions++
      const draft = cloneState(state)
      const result = await operation(
        makeTransaction(draft, entities, locks, (hostnames) => {
          const hook = hostnameLockHook
          hostnameLockHook = undefined
          hook?.(hostnames, draft.claims)
        }),
      )
      state = draft
      return result
    },
  }
  const catalog: TypedEntityCatalog<EntityType, Entity, Context> = overrides.catalog ?? {
    group: { projectLifecycle: () => 'retired' },
    place: {},
  }
  const engine = createTypedEntityEngine({
    ...overrides,
    catalog,
    hooks: overrides.hooks ?? {
      afterCommit: async ({ changes }) => void commits.push(changes),
      audit: async ({ change }) => void audits.push(change),
    },
    store: overrides.store ?? store,
  })
  return {
    audits,
    commits,
    context: { actor: 'member' },
    engine,
    entities,
    locks,
    onNextHostnameLock(
      hook: (hostnames: readonly string[], claims: Map<string, HostnameClaim>) => void,
    ) {
      hostnameLockHook = hook
    },
    get state() {
      return state
    },
    get transactions() {
      return transactions
    },
  }
}

function emptyState(): State {
  return {
    aliases: new Map(),
    associations: new Map(),
    claims: new Map(),
    merges: [],
    parents: new Map(),
  }
}

function cloneState(state: State): State {
  return {
    aliases: new Map(state.aliases),
    associations: new Map(state.associations),
    claims: new Map(state.claims),
    merges: [...state.merges],
    parents: new Map([...state.parents].map(([id, parents]) => [id, new Set(parents)])),
  }
}

function makeTransaction(
  state: State,
  entities: Map<string, Entity>,
  locks: string[],
  onHostnameLock: (hostnames: readonly string[]) => void,
): TypedEntityTransaction<EntityType, Entity> {
  return {
    addParentId: async (id, parentId) => void setFor(state.parents, id).add(parentId),
    getAliasOwner: async (alias) => state.aliases.get(alias) ?? null,
    getEntity: async (id) => entities.get(id) ?? null,
    getHostnameClaim: async (hostname) => state.claims.get(hostname) ?? null,
    listAliases: async (id) => owners(state.aliases, id),
    listChildIds: async (id) =>
      [...state.parents].filter(([, parents]) => parents.has(id)).map(([childId]) => childId),
    listHostnameAssociations: async (id) =>
      [...state.associations.values()].filter((item) => item.entityId === id),
    listHostnameAssociationsByEntityAndHostname: async (id, hostname) =>
      [...state.associations.values()].filter(
        (item) => item.entityId === id && item.hostname === hostname,
      ),
    listHostnameAssociationsByHostname: async (hostname) =>
      [...state.associations.values()].filter((item) => item.hostname === hostname),
    listHostnameClaims: async (id) =>
      [...state.claims.values()].filter((item) => item.entityId === id),
    listParentIds: async (id) => [...(state.parents.get(id) ?? [])],
    lockAliases: async (values) => void locks.push(`aliases:${values.join(',')}`),
    lockEntities: async (values) => void locks.push(`entities:${values.join(',')}`),
    lockHierarchy: async () => void locks.push('hierarchy'),
    lockHostnames: async (values) => {
      locks.push(`hostnames:${values.join(',')}`)
      onHostnameLock(values)
    },
    mergeEntities: async (input) => void state.merges.push(input),
    putAlias: async (id, alias) => void state.aliases.set(alias, id),
    putHostnameAssociation: async (item) => void state.associations.set(key(item), item),
    putHostnameClaim: async (item) => void state.claims.set(item.hostname, item),
    removeHostnameAssociation: async (item) => void state.associations.delete(key(item)),
    removeHostnameClaim: async (item) => void state.claims.delete(item.hostname),
    removeParentId: async (id, parentId) => void state.parents.get(id)?.delete(parentId),
  }
}

function owners(values: Map<string, string>, owner: string): string[] {
  return [...values].filter(([, id]) => id === owner).map(([value]) => value)
}

function key(item: HostnameAssociation): string {
  return `${item.entityId}:${item.hostname}`
}

function setFor(values: Map<string, Set<string>>, id: string): Set<string> {
  const existing = values.get(id)
  if (existing !== undefined) return existing
  const created = new Set<string>()
  values.set(id, created)
  return created
}
