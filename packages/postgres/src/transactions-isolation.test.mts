import { describe, expect, it } from 'vitest'

import type { TransactionIsolationLevel } from './index.mts'
import { withPsql } from './test-helpers.mts'

const ISOLATION = "/* isolation */ SELECT current_setting('transaction_isolation') AS level"

describe('beginTransaction isolationLevel', () => {
  it.each<TransactionIsolationLevel>(['serializable', 'repeatable read'])(
    'opens an owned pool transaction at %s',
    async (isolationLevel) => {
      await withPsql(async (psql) => {
        const transaction = await psql.beginTransaction({ isolationLevel })
        await expect(transaction<{ level: string }>(ISOLATION)).resolves.toMatchObject({
          rows: [{ level: isolationLevel }],
        })
        await transaction.commit()
      })
    },
  )

  it('applies the level when nothing runs before commit', async () => {
    await withPsql(async (psql) => {
      const transaction = await psql.beginTransaction({ isolationLevel: 'serializable' })
      await expect(transaction.commit()).resolves.toBeUndefined()
    })
  })

  it('applies the level on an explicit pool and on a borrowed client', async () => {
    await withPsql(async (psql) => {
      const pooled = await psql.beginTransaction({
        client: psql.readPool,
        isolationLevel: 'serializable',
      })
      await expect(pooled<{ level: string }>(ISOLATION)).resolves.toMatchObject({
        rows: [{ level: 'serializable' }],
      })
      await pooled.rollback()

      const client = await psql.writePool.connect()
      try {
        const borrowed = await psql.beginTransaction({ client, isolationLevel: 'serializable' })
        await expect(borrowed<{ level: string }>(ISOLATION)).resolves.toMatchObject({
          rows: [{ level: 'serializable' }],
        })
        await borrowed.commit()
      } finally {
        client.release()
      }
    })
  })

  it('keeps the default level when no isolation level is given', async () => {
    await withPsql(async (psql) => {
      const transaction = await psql.beginTransaction()
      await expect(transaction<{ level: string }>(ISOLATION)).resolves.toMatchObject({
        rows: [{ level: 'read committed' }],
      })
      await transaction.commit()
    })
  })

  it.each(['read committed; DROP TABLE x', 42])(
    'rejects the unknown level %j before acquiring a connection',
    async (isolationLevel) => {
      await withPsql(async (psql) => {
        const before = psql.writePool.totalCount
        await expect(
          psql.beginTransaction({ isolationLevel: isolationLevel as never }),
        ).rejects.toThrow(
          `Unsupported transaction isolation level: ${JSON.stringify(isolationLevel)}`,
        )
        expect(psql.writePool.totalCount).toBe(before)
      })
    },
  )
})
