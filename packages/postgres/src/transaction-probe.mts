import type pg from 'pg'

const TRANSACTION_PROBE_SAVEPOINT = 'vouchington_transaction_probe'

export async function isInTransaction(
  client: pg.PoolClient,
  queryTimeoutMs?: number,
): Promise<boolean> {
  const probe = (text: string) =>
    client.query(
      queryTimeoutMs === undefined
        ? text
        : ({ query_timeout: queryTimeoutMs, text } as pg.QueryConfig),
    )
  try {
    await probe(`SAVEPOINT ${TRANSACTION_PROBE_SAVEPOINT}`)
    await probe(`RELEASE SAVEPOINT ${TRANSACTION_PROBE_SAVEPOINT}`)
    return true
  } catch (error) {
    if ((error as { code?: string }).code === '25P01') return false
    throw error
  }
}
