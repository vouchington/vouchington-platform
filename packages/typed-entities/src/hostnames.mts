import { HostnameClaimedError } from './errors.mts'
import type { Runtime } from './runtime.mts'
import {
  removeAssociation,
  removeAssociationOperation,
  removeClaim,
  resolveAssociations,
  resolveClaim,
} from './hostname-helpers.mts'
import type { TypedEntity } from './types.mts'

export function createHostnameOperations<
  TType extends string,
  TEntity extends TypedEntity<TType>,
  TContext,
>(runtime: Runtime<TType, TEntity, TContext>) {
  const claim = (context: TContext, entityId: string, value: string, primary: boolean) =>
    runtime.run(context, async (transaction, change) => {
      const hostname = runtime.hostname(value)
      await transaction.lockEntities([entityId])
      await transaction.lockHostnames([hostname])
      const entity = await runtime.entity(transaction, entityId)
      const policy = runtime.policy(entity)
      await runtime.permit(
        context,
        entity,
        'claim hostname',
        policy.canClaimHostname?.({ context, entity, hostname, primary }),
      )
      const existing = await transaction.getHostnameClaim(hostname)
      if (existing !== null && existing.entityId !== entityId) {
        const owner = await transaction.getEntity(existing.entityId)
        const reclaim = policy.mayReclaimHostname?.({
          context,
          entity,
          hostname,
          owner,
          primary,
        })
        if (reclaim === undefined || !(await reclaim)) {
          throw new HostnameClaimedError(hostname, existing.entityId)
        }
        await removeClaim(transaction, existing, change)
      }
      if (existing?.entityId === entityId && (existing.primary || !primary)) return hostname
      const current = await transaction.listHostnameClaims(entityId)
      if (primary) {
        for (const item of current.filter((item) => item.primary && item.hostname !== hostname)) {
          await removeClaim(transaction, item, change)
        }
      }
      if (existing?.entityId === entityId) await removeClaim(transaction, existing, change)
      const item = { entityId, hostname, primary }
      await transaction.putHostnameClaim(item)
      await change({ kind: 'hostname.claimed', ...item })
      return hostname
    })

  const remove = (context: TContext, entityId: string, value: string, primary: boolean) =>
    runtime.run(context, async (transaction, change) => {
      const hostname = runtime.hostname(value)
      await transaction.lockEntities([entityId])
      await transaction.lockHostnames([hostname])
      const entity = await runtime.entity(transaction, entityId)
      const policy = runtime.policy(entity)
      await runtime.permit(
        context,
        entity,
        'remove hostname claim',
        policy.canRemoveHostname?.({ context, entity, hostname, primary }),
      )
      const existing = await transaction.getHostnameClaim(hostname)
      if (existing?.entityId === entityId && existing.primary === primary) {
        await removeClaim(transaction, existing, change)
      }
    })

  const clear = (context: TContext, entityId: string, primary: boolean) =>
    runtime.run(context, async (transaction, change) => {
      await transaction.lockEntities([entityId])
      const entity = await runtime.entity(transaction, entityId)
      const claims = (await transaction.listHostnameClaims(entityId))
        .filter((item) => item.primary === primary)
        .toSorted((left, right) => left.hostname.localeCompare(right.hostname))
      await transaction.lockHostnames(claims.map((item) => item.hostname))
      const policy = runtime.policy(entity)
      for (const item of claims) {
        await runtime.permit(
          context,
          entity,
          'remove hostname claim',
          policy.canRemoveHostname?.({ context, entity, ...item }),
        )
      }
      for (const item of claims) await removeClaim(transaction, item, change)
    })

  const associate = (context: TContext, entityId: string, value: string, primary: boolean) =>
    runtime.run(context, async (transaction, change) => {
      const hostname = runtime.hostname(value)
      await transaction.lockEntities([entityId])
      const entity = await runtime.entity(transaction, entityId)
      const policy = runtime.policy(entity)
      await runtime.permit(
        context,
        entity,
        'associate hostname',
        policy.canClaimHostname?.({ context, entity, hostname, primary }),
      )
      const current = await transaction.listHostnameAssociations(entityId)
      const exact = current.find((item) => item.hostname === hostname)
      if (exact?.primary === primary || (exact?.primary === true && !primary)) return hostname
      if (primary) {
        for (const item of current.filter((item) => item.primary)) {
          await removeAssociation(transaction, item, change)
        }
      }
      if (exact !== undefined) await removeAssociation(transaction, exact, change)
      const item = { entityId, hostname, primary }
      await transaction.putHostnameAssociation(item)
      await change({ kind: 'hostname.associated', ...item })
      return hostname
    })

  return {
    associateAdditionalHostname: (context: TContext, entityId: string, value: string) =>
      associate(context, entityId, value, false),
    associatePrimaryHostname: (context: TContext, entityId: string, value: string) =>
      associate(context, entityId, value, true),
    claimAdditionalHostname: (context: TContext, entityId: string, value: string) =>
      claim(context, entityId, value, false),
    claimPrimaryHostname: (context: TContext, entityId: string, value: string) =>
      claim(context, entityId, value, true),
    clearAdditionalHostnames: (context: TContext, entityId: string) =>
      clear(context, entityId, false),
    clearPrimaryHostname: (context: TContext, entityId: string) => clear(context, entityId, true),
    listHostnameAssociations: (context: TContext, entityId: string) =>
      runtime.run(context, async (transaction) => {
        await runtime.entity(transaction, entityId)
        return transaction.listHostnameAssociations(entityId)
      }),
    listHostnameClaims: (context: TContext, entityId: string) =>
      runtime.run(context, async (transaction) => {
        await runtime.entity(transaction, entityId)
        return transaction.listHostnameClaims(entityId)
      }),
    removeAdditionalHostname: (context: TContext, entityId: string, value: string) =>
      remove(context, entityId, value, false),
    removeHostnameAssociation: removeAssociationOperation(runtime),
    removePrimaryHostname: (context: TContext, entityId: string, value: string) =>
      remove(context, entityId, value, true),
    resolveHostnameClaim: (context: TContext, value: string) =>
      resolveClaim(runtime, context, value),
    resolveHostnameAssociations: (context: TContext, value: string) =>
      resolveAssociations(runtime, context, value),
  }
}
