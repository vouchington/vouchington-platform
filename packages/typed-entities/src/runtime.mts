import { normalizeAsciiHostname } from '@vouchington/utils/urls'
import { normalizeKey } from '@vouchington/utils/strings'

import {
  EntityNotFoundError,
  InvalidAliasError,
  InvalidHostnameError,
  PolicyDeniedError,
  UnknownEntityTypeError,
} from './errors.mts'
import type {
  TypedEntity,
  TypedEntityChange,
  TypedEntityEngineOptions,
  TypedEntityPolicy,
  TypedEntityTransaction,
} from './types.mts'

export type Runtime<TType extends string, TEntity extends TypedEntity<TType>, TContext> = {
  readonly alias: (value: string) => string
  readonly entity: (
    transaction: TypedEntityTransaction<TType, TEntity>,
    id: string,
  ) => Promise<TEntity>
  readonly hostname: (value: string) => string
  readonly permit: (
    context: TContext,
    entity: TEntity,
    operation: string,
    check?: boolean | Promise<boolean>,
  ) => Promise<void>
  readonly policy: (entity: TEntity) => TypedEntityPolicy<TType, TEntity, TContext>
  readonly run: <TResult>(
    context: TContext,
    operation: (
      transaction: TypedEntityTransaction<TType, TEntity>,
      change: (change: TypedEntityChange) => Promise<void>,
    ) => Promise<TResult>,
  ) => Promise<TResult>
}

export function createRuntime<TType extends string, TEntity extends TypedEntity<TType>, TContext>(
  options: TypedEntityEngineOptions<TType, TEntity, TContext>,
): Runtime<TType, TEntity, TContext> {
  const policy = (entity: TEntity): TypedEntityPolicy<TType, TEntity, TContext> => {
    const value = options.catalog[entity.type]
    if (value === undefined) throw new UnknownEntityTypeError(entity.type)
    return value
  }
  return {
    alias(value) {
      const normalized = (options.normalizeAlias ?? normalizeAlias)(value)
      if (normalized === null) throw new InvalidAliasError(value)
      return normalized
    },
    async entity(transaction, id) {
      const entity = await transaction.getEntity(id)
      if (entity === null) throw new EntityNotFoundError(id)
      policy(entity)
      return entity
    },
    hostname(value) {
      const normalized = (options.normalizeHostname ?? normalizeAsciiHostname)(value)
      if (normalized === null) throw new InvalidHostnameError(value)
      return normalized
    },
    async permit(context, entity, operation, check) {
      if (check !== undefined && !(await check)) throw new PolicyDeniedError(operation, entity.type)
      const active = policy(entity).isActive
      if (active !== undefined && !(await active({ context, entity }))) {
        throw new PolicyDeniedError('use inactive entity', entity.type)
      }
    },
    policy,
    async run(context, operation) {
      const changes: TypedEntityChange[] = []
      const result = await options.store.transact(context, (transaction) =>
        operation(transaction, async (change) => {
          await options.hooks?.audit?.({ change, context, transaction })
          changes.push(change)
        }),
      )
      if (changes.length > 0) await options.hooks?.afterCommit?.({ changes, context })
      return result
    },
  }
}

function normalizeAlias(value: string): string | null {
  return normalizeKey(value) || null
}
