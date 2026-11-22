import { AsyncLocalStorage } from 'node:async_hooks'

import type { PoolClient, QueryExecutor, QueryOptions, TransactionQuery } from './types.mts'

export type PostCommitAction = () => Promise<void> | void

type Scope = { owner: QueryExecutor; actions: PostCommitAction[]; parent?: Scope | undefined }

/** The settle surface of a `Psql` transaction resource. */
export type OwnableTransaction = TransactionQuery & {
  commit: () => Promise<void>
  rollback: () => Promise<void>
  [Symbol.asyncDispose]: () => PromiseLike<void>
}

export type RunTransactionOptions = <Result>(
  options: QueryOptions,
  handler: (query: TransactionQuery) => Promise<Result>,
) => Promise<Result>

export interface PostCommitActionsOptions {
  /** Receives each action failure after commit; the commit itself has already succeeded. */
  reportError: (error: Error) => void
  /** Message thrown when `register` is called outside an owned transaction. */
  unownedMessage?: string
}

export interface PostCommitActions {
  /**
   * Claims a transaction so `register` works on it and its nested scopes. Pass `wrapped` when the
   * application decorates the query (capture, normalization); the wrapper becomes the owner and is
   * returned with `commit`, `rollback` and disposal overridden.
   */
  own: <T extends OwnableTransaction = OwnableTransaction>(
    transaction: OwnableTransaction,
    wrapped?: T,
  ) => T
  /** Queues `action` to run after the owning transaction commits; dropped on rollback or disposal. */
  register: (query: QueryExecutor, action: PostCommitAction) => void
  /**
   * Runs `run(options, handler)` so actions registered in a nested scope on an owned transaction
   * move to the owner only when the scope resolves; a rejected scope discards them. `wrapQuery`
   * decorates queries that are not already owned.
   */
  withTransactionOptions: <Result>(
    run: RunTransactionOptions,
    options: QueryOptions,
    handler: (query: TransactionQuery) => Promise<Result>,
    wrapQuery?: (query: TransactionQuery) => TransactionQuery,
  ) => Promise<Result>
}

function isPoolClient(client: unknown): client is PoolClient {
  return typeof client === 'object' && client !== null && 'release' in client
}

function isTransactionQuery(query: QueryExecutor): query is TransactionQuery {
  return 'client' in query && isPoolClient(query.client)
}

/**
 * Deferred side effects (cache invalidation, enqueues) that must run only after a transaction
 * commits. Each factory call owns its own registries.
 */
export function createPostCommitActions(options: PostCommitActionsOptions): PostCommitActions {
  const unownedMessage =
    options.unownedMessage ?? 'Post-commit actions require an owned transaction query'
  const pending = new WeakMap<QueryExecutor, PostCommitAction[]>()
  const owners = new WeakMap<QueryExecutor, QueryExecutor>()
  const ownersByClient = new WeakMap<PoolClient, QueryExecutor>()
  const scopes = new AsyncLocalStorage<Scope>()

  function register(query: QueryExecutor, action: PostCommitAction): void {
    const scope = scopes.getStore()
    const owner = owners.get(query) ?? scope?.owner
    if (!owner) throw new Error(unownedMessage)
    if (scope?.owner === owner) {
      scope.actions.push(action)
      return
    }
    const actions = pending.get(owner) ?? []
    actions.push(action)
    pending.set(owner, actions)
  }

  async function runActions(query: QueryExecutor): Promise<void> {
    const actions = pending.get(query)
    pending.delete(query)
    if (!actions) return
    const results = await Promise.allSettled(actions.map(async (action) => action()))
    for (const result of results) {
      if (result.status === 'rejected') {
        options.reportError(
          result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
        )
      }
    }
  }

  function own<T extends OwnableTransaction = OwnableTransaction>(
    transaction: OwnableTransaction,
    wrapped?: T,
  ): T {
    const owned = (wrapped ?? transaction) as T
    owners.set(owned, owned)
    ownersByClient.set(owned.client, owned)
    const { commit, rollback } = transaction
    const dispose = transaction[Symbol.asyncDispose]
    const detach = () => {
      if (ownersByClient.get(owned.client) === owned) ownersByClient.delete(owned.client)
    }
    const settle = (
      settleTransaction: () => PromiseLike<void>,
      afterSettle?: () => Promise<void>,
    ) => {
      return async () => {
        detach()
        try {
          await settleTransaction()
          await afterSettle?.()
        } finally {
          pending.delete(owned)
          owners.delete(owned)
          detach()
        }
      }
    }
    return Object.assign(owned, {
      commit: settle(commit, () => runActions(owned)),
      rollback: settle(rollback),
      [Symbol.asyncDispose]: settle(dispose),
    })
  }

  async function withTransactionOptions<Result>(
    run: RunTransactionOptions,
    queryOptions: QueryOptions,
    handler: (query: TransactionQuery) => Promise<Result>,
    wrapQuery: (query: TransactionQuery) => TransactionQuery = (query) => query,
  ): Promise<Result> {
    const { query, client } = queryOptions
    const owner = query
      ? (owners.get(query) ??
        (isTransactionQuery(query) ? ownersByClient.get(query.client) : undefined))
      : isPoolClient(client)
        ? ownersByClient.get(client)
        : undefined
    const parentScope = scopes.getStore()
    const scope: Scope | undefined = owner
      ? { owner, actions: [], parent: parentScope?.owner === owner ? parentScope : undefined }
      : undefined
    const result = await run(queryOptions, async (nested) => {
      const scoped = owners.has(nested) ? nested : wrapQuery(nested)
      // An unowned transaction must not inherit an outer scope's registrations.
      return scope ? scopes.run(scope, () => handler(scoped)) : scopes.exit(() => handler(scoped))
    })
    if (scope) {
      const actions = scope.parent?.actions ?? pending.get(scope.owner) ?? []
      actions.push(...scope.actions)
      if (!scope.parent) pending.set(scope.owner, actions)
    }
    return result
  }

  return { own, register, withTransactionOptions }
}
