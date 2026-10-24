import type { TransactionQuery } from './types.mts'

export interface TransactionLockOnceOptions<Query extends TransactionQuery = TransactionQuery> {
  /** Prefix hashed with each id, e.g. `'topic-hostname:'`. */
  namespace: string
  /** Leading SQL annotation for query telemetry. */
  annotation: string
  /** Defaults to lower-casing. */
  normalize?: (id: string) => string
  /**
   * Optional custom acquisition. It receives the sorted, not-yet-held ids and returns the ids it
   * actually locked (for statements that expand to related ids). Defaults to one
   * `pg_advisory_xact_lock(hashtextextended(namespace || id, 0))` statement over the sorted ids.
   */
  acquire?: (query: Query, ids: readonly string[]) => Promise<readonly string[] | void>
}

export interface TransactionLockOnce<Query extends TransactionQuery = TransactionQuery> {
  lock: (query: Query, ids: readonly string[]) => Promise<void>
  /** Marks ids as held without locking, e.g. rows this transaction just inserted. */
  markHeld: (query: Query, ids: readonly string[]) => void
}

const lowerCase = (id: string): string => id.toLowerCase()

/**
 * Takes transaction-scoped advisory locks at most once per transaction query object.
 *
 * Calls on one query are serialized, so concurrent calls (for example inside `Promise.all`) send
 * each lock statement once, in submission order. A failed acquisition rejects only its own caller.
 * Never reuse a query object to lock again after rolling back a savepoint taken on it: the held
 * set cannot see the rollback.
 */
export function createTransactionLockOnce<Query extends TransactionQuery = TransactionQuery>(
  options: TransactionLockOnceOptions<Query>,
): TransactionLockOnce<Query> {
  const { namespace, annotation, normalize = lowerCase } = options
  if (!annotation.trim() || annotation.includes('*/'))
    throw new TypeError('Lock annotation must be non-empty and must not contain "*/"')
  const statement = `/* ${annotation.trim()} */
    WITH ordered AS MATERIALIZED (
      SELECT id, position FROM unnest($2::text[]) WITH ORDINALITY AS input(id, position)
    )
    SELECT pg_advisory_xact_lock(hashtextextended($1 || id, 0))
    FROM ordered
    ORDER BY position`
  const acquire =
    options.acquire ??
    (async (query: Query, ids: readonly string[]) => {
      await query(statement, [namespace, ids])
    })
  const heldByQuery = new WeakMap<Query, Set<string>>()
  const pendingByQuery = new WeakMap<Query, Promise<void>>()

  const heldFor = (query: Query): Set<string> => {
    const existing = heldByQuery.get(query)
    if (existing) return existing
    const created = new Set<string>()
    heldByQuery.set(query, created)
    return created
  }

  const acquireMissing = async (
    query: Query,
    previous: Promise<void> | undefined,
    requested: readonly string[],
  ): Promise<void> => {
    // The failed caller owns its rejection; a later call must still run and acquire its locks.
    if (previous) await previous.catch(() => undefined)
    const held = heldFor(query)
    const ids = [...new Set(requested.map(normalize))].toSorted().filter((id) => !held.has(id))
    if (ids.length === 0) return
    const reported = await acquire(query, ids)
    // `ids` are already normalized; only ids a custom acquire reports need normalizing.
    const locked = reported ? reported.map(normalize) : ids
    for (const id of locked) held.add(id)
  }

  return {
    async lock(query, ids) {
      if (ids.length === 0) return
      const pending = acquireMissing(query, pendingByQuery.get(query), ids)
      pendingByQuery.set(query, pending)
      try {
        await pending
      } finally {
        if (pendingByQuery.get(query) === pending) pendingByQuery.delete(query)
      }
    },
    markHeld(query, ids) {
      const held = heldFor(query)
      for (const id of ids) held.add(normalize(id))
    },
  }
}
