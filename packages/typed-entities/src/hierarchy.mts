import { HierarchyCycleError } from './errors.mts'
import type { Runtime } from './runtime.mts'
import type { TypedEntity, TypedEntityTransaction } from './types.mts'

export function createHierarchyOperations<
  TType extends string,
  TEntity extends TypedEntity<TType>,
  TContext,
>(runtime: Runtime<TType, TEntity, TContext>) {
  const relation = (context: TContext, entityId: string, parentId: string, add: boolean) =>
    runtime.run(context, async (transaction, change) => {
      const parents = await validateParentRelation(
        runtime,
        context,
        transaction,
        entityId,
        parentId,
        add,
      )
      if (add && !parents.includes(parentId)) {
        await transaction.addParentId(entityId, parentId)
        await change({ entityId, kind: 'parent.added', parentId })
      } else if (!add && parents.includes(parentId)) {
        await transaction.removeParentId(entityId, parentId)
        await change({ entityId, kind: 'parent.removed', parentId })
      }
    })
  return {
    addParent: (context: TContext, entityId: string, parentId: string) =>
      relation(context, entityId, parentId, true),
    listChildren: (context: TContext, entityId: string) =>
      runtime.run(context, async (transaction) => {
        await runtime.entity(transaction, entityId)
        return transaction.listChildIds(entityId)
      }),
    listParents: (context: TContext, entityId: string) =>
      runtime.run(context, async (transaction) => {
        await runtime.entity(transaction, entityId)
        return transaction.listParentIds(entityId)
      }),
    removeParent: (context: TContext, entityId: string, parentId: string) =>
      relation(context, entityId, parentId, false),
    validateParent: (context: TContext, entityId: string, parentId: string) =>
      runtime.run(context, async (transaction) => {
        await validateParentRelation(runtime, context, transaction, entityId, parentId, true)
      }),
  }
}

async function validateParentRelation<
  TType extends string,
  TEntity extends TypedEntity<TType>,
  TContext,
>(
  runtime: Runtime<TType, TEntity, TContext>,
  context: TContext,
  transaction: TypedEntityTransaction<TType, TEntity>,
  entityId: string,
  parentId: string,
  add: boolean,
): Promise<readonly string[]> {
  await transaction.lockHierarchy()
  await transaction.lockEntities([entityId, parentId].toSorted())
  const entity = await runtime.entity(transaction, entityId)
  const parent = await runtime.entity(transaction, parentId)
  const policy = runtime.policy(entity)
  await runtime.permit(
    context,
    entity,
    add ? 'add parent' : 'remove parent',
    policy.canParent?.({ context, entity, parent }),
  )
  if (add) await runtime.permit(context, parent, 'add parent')
  const parents = await transaction.listParentIds(entityId)
  if (add && !parents.includes(parentId)) await assertAcyclic(transaction, entityId, parentId)
  return parents
}

async function assertAcyclic<TType extends string, TEntity extends TypedEntity<TType>>(
  transaction: TypedEntityTransaction<TType, TEntity>,
  entityId: string,
  parentId: string,
): Promise<void> {
  const pending = [parentId]
  const seen = new Set<string>()
  while (pending.length > 0) {
    const cursor = pending.pop()!
    if (cursor === entityId) throw new HierarchyCycleError(entityId, parentId)
    if (!seen.has(cursor)) {
      seen.add(cursor)
      pending.push(...(await transaction.listParentIds(cursor)))
    }
  }
}
