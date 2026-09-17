import pg from 'pg'
import { describe, expect, it } from 'vitest'

import type { Psql } from './create-psql-types.mts'
import { databaseUrl, withPsql } from './test-helpers.mts'

const DIRTY_CLIENT =
  'Cannot begin a transaction on a pool client that already has a transaction open'

describe('owned transactions on a pool client released mid-transaction', () => {
  it.each(['withTransactionOptions', 'beginTransaction'] as const)(
    '%s rejects the dirty client and never commits its abandoned work',
    async (api) => {
      const table = `dirty_pool_${crypto.randomUUID().replaceAll('-', '')}`
      const pool = new pg.Pool({ connectionString: databaseUrl(), max: 1 })
      try {
        await withPsql(async (psql) => {
          await psql.write(`/* create */ CREATE TABLE ${table} (id int PRIMARY KEY)`)
          const abandoned = await pool.connect()
          await abandoned.query('BEGIN')
          await abandoned.query(`INSERT INTO ${table} (id) VALUES (1)`)
          abandoned.release()

          await expect(insertOnPool(psql, pool, api, table, 2)).rejects.toThrow(DIRTY_CLIENT)
          await insertOnPool(psql, pool, api, table, 3)
          await expect(
            psql.read(`/* ids */ SELECT id FROM ${table} ORDER BY id`),
          ).resolves.toMatchObject({ rows: [{ id: 3 }] })
          await psql.write(`/* drop */ DROP TABLE ${table}`)
        })
      } finally {
        await pool.end()
      }
    },
  )
})

async function insertOnPool(
  psql: Psql,
  pool: pg.Pool,
  api: 'withTransactionOptions' | 'beginTransaction',
  table: string,
  id: number,
): Promise<void> {
  const text = `/* insertOnPool */ INSERT INTO ${table} (id) VALUES ($1)`
  if (api === 'withTransactionOptions') {
    await psql.withTransactionOptions({ client: pool }, async (query) => query(text, [id]))
    return
  }
  const transaction = await psql.beginTransaction({ client: pool })
  await transaction(text, [id])
  await transaction.commit()
}
