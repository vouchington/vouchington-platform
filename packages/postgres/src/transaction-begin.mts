import type pg from 'pg'

const ACTIVE_SQL_TRANSACTION = '25001'

/**
 * Sends `BEGIN` and rejects when the session already had a transaction open.
 *
 * A pool can hand out a connection whose previous holder released it
 * mid-transaction. PostgreSQL answers a nested `BEGIN` with only a `25001`
 * WARNING, so committing would also persist the abandoned work. The notice
 * arrives before `BEGIN`'s ReadyForQuery, which is when its promise settles, so
 * the listener has observed it by the time `begin` resolves. Unlike
 * `getTransactionStatus()`, this needs no extra round trip and cannot read a
 * stale status, and an idle session sees no server-side ERROR.
 */
export async function beginTransactionBlock(
  client: pg.PoolClient,
  begin: () => Promise<unknown>,
): Promise<void> {
  let active = false
  const onNotice = (notice: { code?: string | undefined }) => {
    if (notice.code === ACTIVE_SQL_TRANSACTION) active = true
  }
  client.on('notice', onNotice)
  try {
    await begin()
  } finally {
    client.off('notice', onNotice)
  }
  if (active)
    throw new Error(
      'Cannot begin a transaction on a pool client that already has a transaction open',
    )
}
