import type { QueryExecutor } from '../types.mts'

export type SharedDbScope =
  | { kind: 'ids'; ids: readonly string[] }
  | { kind: 'cursor'; id: string }
  | { kind: 'global' }

/**
 * A keyset read reported around a scope-bounded query. The application supplies the payload for
 * each phase; `identity` correlates a start with its completion.
 */
export type SharedDbKeysetRead<
  Start extends object = Record<string, unknown>,
  Completed extends object = Record<string, unknown>,
> =
  | ({ phase: 'start'; identity: symbol } & Start)
  | ({ phase: 'completed'; identity: symbol } & Completed)

export type SharedDbScopeEvent<
  Operation extends string,
  Table extends string,
  KeysetRead extends SharedDbKeysetRead = SharedDbKeysetRead,
> = {
  operation: Operation
  table: Table
  scope: SharedDbScope
  keysetRead?: KeysetRead
  transaction?: QueryExecutor
}

export type SharedDbScopeObserver<
  Operation extends string,
  Table extends string,
  KeysetRead extends SharedDbKeysetRead = SharedDbKeysetRead,
> = (event: SharedDbScopeEvent<Operation, Table, KeysetRead>) => void

export interface SharedDbScopeObserverOptions<Operation extends string, Table extends string> {
  /** Operation to table map; the application owns the vocabulary. */
  tables: Readonly<Record<Operation, Table>>
  /** Registry key for `Symbol.for`, so separate module graphs share one installed observer. */
  key: string
}

/**
 * A process-global, test-installable observer for service calls that must stay inside an owned
 * scope. `observe` is a no-op until `install` registers a callback.
 */
export function createSharedDbScopeObserver<
  Operation extends string,
  Table extends string,
  KeysetRead extends SharedDbKeysetRead = SharedDbKeysetRead,
>(options: SharedDbScopeObserverOptions<Operation, Table>) {
  const symbol = Symbol.for(options.key)
  const host = globalThis as unknown as Record<
    symbol,
    SharedDbScopeObserver<Operation, Table, KeysetRead> | undefined
  >
  return {
    install(observer: SharedDbScopeObserver<Operation, Table, KeysetRead> | undefined): void {
      host[symbol] = observer
    },
    observe(
      operation: Operation,
      scope: SharedDbScope,
      keysetRead?: KeysetRead,
      transaction?: QueryExecutor,
    ): void {
      host[symbol]?.({
        operation,
        table: options.tables[operation],
        scope,
        ...(keysetRead ? { keysetRead } : {}),
        ...(transaction ? { transaction } : {}),
      })
    },
  }
}

export function sharedDbIdsScope(ids?: readonly string[]): SharedDbScope {
  return ids ? { kind: 'ids', ids } : { kind: 'global' }
}

export function sharedDbCursorScope(id?: string | null): SharedDbScope {
  return id ? { kind: 'cursor', id } : { kind: 'global' }
}
