import type { QueryExecutor } from '../types.mts'

export type SharedDbScope =
  | { kind: 'ids'; ids: readonly string[] }
  | { kind: 'cursor'; id: string }
  | { kind: 'global' }

export type SharedDbKeysetRead =
  | {
      phase: 'start'
      identity: symbol
      actorId: string
      after: { timestamp: unknown; id: unknown } | undefined
      limit: number
      sqlLimit: unknown
    }
  | {
      phase: 'completed'
      identity: symbol
      rowCount: number
      first: { id: string; timestamp: string } | undefined
    }

export type SharedDbScopeEvent<Operation extends string, Table extends string> = {
  operation: Operation
  table: Table
  scope: SharedDbScope
  keysetRead?: SharedDbKeysetRead
  transaction?: QueryExecutor
}

export type SharedDbScopeObserver<Operation extends string, Table extends string> = (
  event: SharedDbScopeEvent<Operation, Table>,
) => void

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
export function createSharedDbScopeObserver<Operation extends string, Table extends string>(
  options: SharedDbScopeObserverOptions<Operation, Table>,
) {
  const symbol = Symbol.for(options.key)
  const host = globalThis as unknown as Record<
    symbol,
    SharedDbScopeObserver<Operation, Table> | undefined
  >
  return {
    install(observer: SharedDbScopeObserver<Operation, Table> | undefined): void {
      host[symbol] = observer
    },
    observe(
      operation: Operation,
      scope: SharedDbScope,
      keysetRead?: SharedDbKeysetRead,
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
