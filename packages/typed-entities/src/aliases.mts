import { AliasClaimedError, InvalidEntityMergeError } from './errors.mts'
import type { Runtime } from './runtime.mts'
import type { TypedEntity, TypedEntityTransaction } from './types.mts'

export function createAliasOperations<
  TType extends string,
  TEntity extends TypedEntity<TType>,
  TContext,
>(runtime: Runtime<TType, TEntity, TContext>) {
  return {
    claimAlias(context: TContext, entityId: string, value: string) {
      return runtime.run(context, async (transaction, change) => {
        const alias = runtime.alias(value)
        await transaction.lockEntities([entityId])
        await transaction.lockAliases([alias])
        const entity = await runtime.entity(transaction, entityId)
        const policy = runtime.policy(entity)
        await runtime.permit(
          context,
          entity,
          'claim alias',
          policy.canClaimAlias?.({ alias, context, entity }),
        )
        const owner = await transaction.getAliasOwner(alias)
        if (owner !== null && owner !== entityId) throw new AliasClaimedError(alias, owner)
        if (owner === null) {
          await transaction.putAlias(entityId, alias)
          await change({ alias, entityId, kind: 'alias.claimed' })
        }
        return alias
      })
    },
    merge(context: TContext, sourceId: string, targetId: string) {
      return runtime.run(context, async (transaction, change) => {
        if (sourceId === targetId) throw new InvalidEntityMergeError(sourceId, targetId)
        await transaction.lockEntities([sourceId, targetId].toSorted())
        const source = await runtime.entity(transaction, sourceId)
        const target = await runtime.entity(transaction, targetId)
        await assertMergePolicy(runtime, context, source, target)
        const aliases = await normalizedAliases(runtime, transaction, source)
        await transaction.lockAliases(aliases)
        for (const alias of aliases) {
          const owner = await transaction.getAliasOwner(alias)
          if (owner !== null && owner !== sourceId && owner !== targetId) {
            throw new AliasClaimedError(alias, owner)
          }
        }
        for (const alias of aliases) await transaction.putAlias(targetId, alias)
        const input = {
          aliases,
          lifecycle: runtime.policy(source).projectLifecycle?.({ context, entity: source }),
          sourceId,
          sourceSlug: source.slug,
          targetId,
        }
        await transaction.mergeEntities(input)
        await change({ kind: 'entity.merged', ...input })
      })
    },
  }
}

async function normalizedAliases<
  TType extends string,
  TEntity extends TypedEntity<TType>,
  TContext,
>(
  runtime: Runtime<TType, TEntity, TContext>,
  transaction: TypedEntityTransaction<TType, TEntity>,
  source: TEntity,
): Promise<readonly string[]> {
  return [
    ...new Set([source.slug, ...(await transaction.listAliases(source.id))].map(runtime.alias)),
  ].toSorted()
}

async function assertMergePolicy<
  TType extends string,
  TEntity extends TypedEntity<TType>,
  TContext,
>(runtime: Runtime<TType, TEntity, TContext>, context: TContext, source: TEntity, target: TEntity) {
  if (source.type !== target.type) throw new InvalidEntityMergeError(source.id, target.id)
  const sourcePolicy = runtime.policy(source)
  const targetPolicy = runtime.policy(target)
  await runtime.permit(
    context,
    source,
    'merge',
    sourcePolicy.canMerge?.({ context, entity: source, target }),
  )
  await runtime.permit(
    context,
    source,
    'merge incompatible entity',
    sourcePolicy.isCompatible?.({ context, entity: source, other: target }),
  )
  await runtime.permit(
    context,
    target,
    'merge incompatible entity',
    targetPolicy.isCompatible?.({ context, entity: target, other: source }),
  )
}
