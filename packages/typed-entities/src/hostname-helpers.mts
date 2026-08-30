import type { Runtime } from './runtime.mts'
import type {
  HostnameAssociation,
  HostnameClaim,
  HostnameResolution,
  TypedEntity,
  TypedEntityChange,
  TypedEntityTransaction,
} from './types.mts'

type Change = (change: TypedEntityChange) => Promise<void>

export async function removeClaim<TType extends string, TEntity extends TypedEntity<TType>>(
  transaction: TypedEntityTransaction<TType, TEntity>,
  item: HostnameClaim,
  change: Change,
): Promise<void> {
  await transaction.removeHostnameClaim(item)
  await change({ kind: 'hostname.claim.removed', ...item })
}

export async function removeAssociation<TType extends string, TEntity extends TypedEntity<TType>>(
  transaction: TypedEntityTransaction<TType, TEntity>,
  item: HostnameAssociation,
  change: Change,
): Promise<void> {
  await transaction.removeHostnameAssociation(item)
  await change({ kind: 'hostname.association.removed', ...item })
}

export function removeAssociationOperation<
  TType extends string,
  TEntity extends TypedEntity<TType>,
  TContext,
>(runtime: Runtime<TType, TEntity, TContext>) {
  return (context: TContext, entityId: string, value: string) =>
    runtime.run(context, async (transaction, change) => {
      const hostname = runtime.hostname(value)
      await transaction.lockEntities([entityId])
      const entity = await runtime.entity(transaction, entityId)
      const matches = await transaction.listHostnameAssociationsByEntityAndHostname(
        entityId,
        hostname,
      )
      const policy = runtime.policy(entity)
      for (const item of matches) {
        await runtime.permit(
          context,
          entity,
          'remove hostname association',
          policy.canRemoveHostname?.({ context, entity, ...item }),
        )
      }
      for (const item of matches) await removeAssociation(transaction, item, change)
    })
}

export async function resolveClaim<
  TType extends string,
  TEntity extends TypedEntity<TType>,
  TContext,
>(
  runtime: Runtime<TType, TEntity, TContext>,
  context: TContext,
  value: string,
): Promise<HostnameResolution<TEntity> | null> {
  return runtime.run(context, async (transaction) => {
    const hostname = runtime.hostname(value)
    const claim = await transaction.getHostnameClaim(hostname)
    if (claim === null) return null
    return {
      entity: await runtime.entity(transaction, claim.entityId),
      hostname,
      primary: claim.primary,
    }
  })
}

export async function resolveAssociations<
  TType extends string,
  TEntity extends TypedEntity<TType>,
  TContext,
>(runtime: Runtime<TType, TEntity, TContext>, context: TContext, value: string) {
  return runtime.run(context, async (transaction) => {
    const hostname = runtime.hostname(value)
    const associations = await transaction.listHostnameAssociationsByHostname(hostname)
    return Promise.all(
      associations.map(async (item) => ({
        entity: await runtime.entity(transaction, item.entityId),
        hostname,
        primary: item.primary,
      })),
    )
  })
}
