export type TypedEntity<TType extends string> = {
  readonly id: string
  readonly slug: string
  readonly type: TType
}

export type EntityPolicyInput<TEntity, TContext> = {
  readonly context: TContext
  readonly entity: TEntity
}

export type TypedEntityPolicy<
  TType extends string,
  TEntity extends TypedEntity<TType>,
  TContext,
> = {
  readonly canClaimAlias?: (
    input: EntityPolicyInput<TEntity, TContext> & { readonly alias: string },
  ) => boolean | Promise<boolean>
  readonly canClaimHostname?: (
    input: EntityPolicyInput<TEntity, TContext> & HostnameValue,
  ) => boolean | Promise<boolean>
  readonly canMerge?: (
    input: EntityPolicyInput<TEntity, TContext> & { readonly target: TEntity },
  ) => boolean | Promise<boolean>
  readonly canParent?: (
    input: EntityPolicyInput<TEntity, TContext> & { readonly parent: TEntity },
  ) => boolean | Promise<boolean>
  readonly canRemoveHostname?: (
    input: EntityPolicyInput<TEntity, TContext> & HostnameValue,
  ) => boolean | Promise<boolean>
  readonly isActive?: (input: EntityPolicyInput<TEntity, TContext>) => boolean | Promise<boolean>
  readonly isCompatible?: (
    input: EntityPolicyInput<TEntity, TContext> & { readonly other: TEntity },
  ) => boolean | Promise<boolean>
  readonly mayReclaimHostname?: (
    input: EntityPolicyInput<TEntity, TContext> &
      HostnameValue & { readonly owner: TEntity | null },
  ) => boolean | Promise<boolean>
  readonly projectLifecycle?: (input: EntityPolicyInput<TEntity, TContext>) => unknown
}

export type TypedEntityCatalog<
  TType extends string,
  TEntity extends TypedEntity<TType>,
  TContext,
> = Readonly<Record<TType, TypedEntityPolicy<TType, TEntity, TContext>>>

export type HostnameValue = { readonly hostname: string; readonly primary: boolean }
export type HostnameClaim = HostnameValue & { readonly entityId: string }
export type HostnameAssociation = HostnameValue & { readonly entityId: string }
export type HostnameResolution<TEntity> = HostnameValue & { readonly entity: TEntity }

export type MergeInput = {
  readonly aliases: readonly string[]
  readonly lifecycle: unknown
  readonly sourceId: string
  readonly sourceSlug: string
  readonly targetId: string
}

export type ParentInput = { readonly entityId: string; readonly parentId: string }

export type TypedEntityChange =
  | ({ readonly kind: 'alias.claimed' } & { readonly alias: string; readonly entityId: string })
  | ({ readonly kind: 'entity.merged' } & MergeInput)
  | ({ readonly kind: 'parent.added' | 'parent.removed' } & ParentInput)
  | ({ readonly kind: 'hostname.claimed' | 'hostname.claim.removed' } & HostnameClaim)
  | ({
      readonly kind: 'hostname.associated' | 'hostname.association.removed'
    } & HostnameAssociation)

export type TypedEntityTransaction<TType extends string, TEntity extends TypedEntity<TType>> = {
  readonly getEntity: (id: string) => Promise<TEntity | null>
  readonly lockEntities: (ids: readonly string[]) => Promise<void>
  readonly lockAliases: (aliases: readonly string[]) => Promise<void>
  readonly getAliasOwner: (alias: string) => Promise<string | null>
  readonly listAliases: (entityId: string) => Promise<readonly string[]>
  readonly putAlias: (entityId: string, alias: string) => Promise<void>
  readonly mergeEntities: (input: MergeInput) => Promise<void>
  readonly lockHierarchy: () => Promise<void>
  readonly listParentIds: (entityId: string) => Promise<readonly string[]>
  readonly listChildIds: (entityId: string) => Promise<readonly string[]>
  readonly addParentId: (entityId: string, parentId: string) => Promise<void>
  readonly removeParentId: (entityId: string, parentId: string) => Promise<void>
  readonly lockHostnames: (hostnames: readonly string[]) => Promise<void>
  readonly getHostnameClaim: (hostname: string) => Promise<HostnameClaim | null>
  readonly listHostnameClaims: (entityId: string) => Promise<readonly HostnameClaim[]>
  readonly putHostnameClaim: (claim: HostnameClaim) => Promise<void>
  readonly removeHostnameClaim: (claim: HostnameClaim) => Promise<void>
  readonly listHostnameAssociations: (entityId: string) => Promise<readonly HostnameAssociation[]>
  readonly listHostnameAssociationsByHostname: (
    hostname: string,
  ) => Promise<readonly HostnameAssociation[]>
  readonly putHostnameAssociation: (association: HostnameAssociation) => Promise<void>
  readonly removeHostnameAssociation: (association: HostnameAssociation) => Promise<void>
}

export type TypedEntityStore<TType extends string, TEntity extends TypedEntity<TType>, TContext> = {
  readonly transact: <TResult>(
    context: TContext,
    operation: (transaction: TypedEntityTransaction<TType, TEntity>) => Promise<TResult>,
  ) => Promise<TResult>
}

export type TypedEntityHooks<TType extends string, TEntity extends TypedEntity<TType>, TContext> = {
  readonly audit?: (input: {
    readonly change: TypedEntityChange
    readonly context: TContext
    readonly transaction: TypedEntityTransaction<TType, TEntity>
  }) => Promise<void>
  readonly afterCommit?: (input: {
    readonly changes: readonly TypedEntityChange[]
    readonly context: TContext
  }) => Promise<void>
}

export type TypedEntityEngineOptions<
  TType extends string,
  TEntity extends TypedEntity<TType>,
  TContext,
> = {
  readonly catalog: TypedEntityCatalog<TType, TEntity, TContext>
  readonly hooks?: TypedEntityHooks<TType, TEntity, TContext>
  readonly normalizeAlias?: (value: string) => string | null
  readonly normalizeHostname?: (value: string) => string | null
  readonly store: TypedEntityStore<TType, TEntity, TContext>
}
