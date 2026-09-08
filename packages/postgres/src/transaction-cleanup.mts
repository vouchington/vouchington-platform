import type { Transaction } from './create-psql-types.mts'
import type { ErrorHandler } from './types.mts'

export type CleanupOutcome =
  | { kind: 'none' }
  | { kind: 'rolled-back' }
  | { error: unknown; kind: 'control-failed'; rollback?: () => Promise<void> }
  | { error: unknown; kind: 'rollback-failed' }

const cleanupOutcomes = new WeakMap<object, CleanupOutcome>()

export function getTransactionCleanupOutcome(transaction: Transaction): CleanupOutcome {
  return cleanupOutcomes.get(transaction) ?? { kind: 'none' }
}

export function setTransactionCleanupOutcome(
  transaction: Transaction,
  outcome: CleanupOutcome,
): void {
  cleanupOutcomes.set(transaction, outcome)
}

export async function rollbackFailedCommit(transaction: Transaction): Promise<void> {
  const cleanup = getTransactionCleanupOutcome(transaction)
  if (cleanup.kind === 'control-failed' && cleanup.rollback !== undefined) {
    await cleanup.rollback()
  }
}

export function reportFailedCompensatingRollback(
  reportError: ErrorHandler,
  primary: unknown,
  rollback: unknown,
): void {
  try {
    reportError(
      new AggregateError(
        [normalizeError(primary), normalizeError(rollback)],
        'PostgreSQL transaction commit failed and compensating rollback did not complete',
        { cause: primary },
      ),
    )
  } catch {
    // Cleanup reporting must not replace the terminal control failure.
  }
}

function normalizeError(error: unknown): Error {
  return error instanceof Error ? error : new Error(`Transaction failed: ${String(error)}`)
}
