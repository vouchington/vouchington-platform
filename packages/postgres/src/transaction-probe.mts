import type pg from 'pg'

const TRANSACTION_PROBE_SAVEPOINT = 'vouchington_transaction_probe'

/**
 * Reports whether a caller-supplied connection already has a transaction open.
 *
 * Only the borrowed paths may ask: a connection this package acquires from a
 * pool is idle by construction, so probing it would reach an idle backend and
 * make PostgreSQL log a server-side `ERROR` that the `25P01` catch below hides
 * from the application.
 */
export async function isInTransaction(client: pg.PoolClient): Promise<boolean> {
  try {
    await client.query(`SAVEPOINT ${TRANSACTION_PROBE_SAVEPOINT}`)
    await client.query(`RELEASE SAVEPOINT ${TRANSACTION_PROBE_SAVEPOINT}`)
    return true
  } catch (error) {
    if ((error as { code?: string }).code === '25P01') return false
    throw error
  }
}
