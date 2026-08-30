import { HostnameClaimedError } from './errors.mts'
import type { Runtime } from './runtime.mts'
import {
  permitHostnameRemoval,
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
      const entity = await runtime.entity(transaction, entityId)
      const policy = runtime.policy(entity)
      await runtime.permit(
        context,
        entity,
        'claim hostname',
        policy.canClaimHostname?.({ context, entity, hostname, primary }),
      )
      const initial = primary ? await transaction.listHostnameClaims(entityId) : []
      const hostnames = [
        ...new Set([
          hostname,
          ...initial.filter((item) => item.primary).map((item) => item.hostname),
        ]),
      ].toSorted()
      await transaction.lockHostnames(hostnames)
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
        if (owner !== null) {
          await permitHostnameRemoval(
            runtime,
            context,
            owner,
            existing,
            'remove hostname claim',
            true,
          )
        }
        await removeClaim(transaction, existing, change)
      }
      if (existing?.entityId === entityId && (existing.primary || !primary)) return hostname
      const current = await transaction.listHostnameClaims(entityId)
      const displaced = current.filter(
        (item) => primary && item.primary && item.hostname !== hostname,
      )
      if (existing?.entityId === entityId) displaced.push(existing)
      const removals = uniqueByHostname(displaced)
      for (const item of removals) {
        await permitHostnameRemoval(runtime, context, entity, item, 'remove hostname claim')
      }
      for (const item of removals) await removeClaim(transaction, item, change)
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
      await permitHostnameRemoval(
        runtime,
        context,
        entity,
        { entityId, hostname, primary },
        'remove hostname claim',
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
      const snapshot = (await transaction.listHostnameClaims(entityId))
        .filter((item) => item.primary === primary)
        .toSorted((left, right) => left.hostname.localeCompare(right.hostname))
      await transaction.lockHostnames(snapshot.map((item) => item.hostname))
      const claims = []
      for (const item of snapshot) {
        const current = await transaction.getHostnameClaim(item.hostname)
        if (current?.entityId === entityId && current.primary === primary) claims.push(current)
      }
      for (const item of claims)
        await permitHostnameRemoval(runtime, context, entity, item, 'remove hostname claim')
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
      const displaced = current.filter((item) => primary && item.primary)
      if (exact !== undefined) displaced.push(exact)
      const removals = uniqueByHostname(displaced)
      for (const item of removals) {
        await permitHostnameRemoval(runtime, context, entity, item, 'remove hostname association')
      }
      for (const item of removals) await removeAssociation(transaction, item, change)
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

function uniqueByHostname<TItem extends { readonly hostname: string }>(items: readonly TItem[]) {
  return [...new Map(items.map((item) => [item.hostname, item])).values()].toSorted((left, right) =>
    left.hostname.localeCompare(right.hostname),
  )
}
