import { describe, expect, it } from 'vitest'

import { withPsql } from './test-helpers.mts'

const MISSING = '/* missing */ SELECT * FROM definitely_missing_relation'

describe('BEGIN pipelined with the first statement', () => {
  it('surfaces the first statement error itself and commits nothing', async () => {
    await withPsql(async (psql) => {
      const table = `pipelined_${crypto.randomUUID().replaceAll('-', '')}`
      await psql.write(`/* create */ CREATE TABLE ${table} (id int PRIMARY KEY)`)
      try {
        await expect(psql.withTransaction((query) => query(MISSING))).rejects.toMatchObject({
          code: '42P01',
        })

        const transaction = await psql.beginTransaction()
        await expect(transaction(MISSING)).rejects.toMatchObject({ code: '42P01' })
        await expect(
          transaction(`/* insert */ INSERT INTO ${table} (id) VALUES (1)`),
        ).rejects.toMatchObject({ code: '42P01' })
        await expect(transaction.commit()).rejects.toMatchObject({ code: '42P01' })

        await psql.withTransaction(async (query) => {
          await query(`/* insert */ INSERT INTO ${table} (id) VALUES (2)`)
          await query(`/* insert */ INSERT INTO ${table} (id) VALUES (3)`)
        })
        const empty = await psql.beginTransaction()
        await empty.commit()
        await expect(
          psql.read(`/* ids */ SELECT id FROM ${table} ORDER BY id`),
        ).resolves.toMatchObject({ rows: [{ id: 2 }, { id: 3 }] })
      } finally {
        await psql.write(`/* drop */ DROP TABLE ${table}`)
      }
    })
  })

  it('applies the bounded statement timeout to the pipelined first statement', async () => {
    await withPsql(async (psql) => {
      await expect(
        psql.withBoundedTransaction(
          { connectionTimeoutMs: 1000, statementTimeoutMs: 50 },
          (query) => query('/* sleep */ SELECT pg_sleep(1)'),
        ),
      ).rejects.toMatchObject({ code: '57014' })
      await expect(
        psql.withBoundedTransaction(
          { connectionTimeoutMs: 1000, statementTimeoutMs: 5000 },
          (query) =>
            query<{ timeout: string }>(
              "/* timeout */ SELECT current_setting('statement_timeout') AS timeout",
            ),
        ),
      ).resolves.toMatchObject({ rows: [{ timeout: '5s' }] })
    })
  })

  it('reports query timings for the pipelined batch', async () => {
    const timings: Array<{ annotation: string | null; pipelined?: boolean; batchSize?: number }> =
      []
    await withPsql(
      async (psql) => {
        await psql.withTransaction(async (query) => {
          await query('/* first */ SELECT 1')
          await query('/* second */ SELECT 2')
        })
      },
      {
        onQueryTiming: ({ annotation, pipelined, batchSize }) =>
          timings.push({
            annotation,
            ...(pipelined === undefined ? {} : { pipelined }),
            ...(batchSize === undefined ? {} : { batchSize }),
          }),
      },
    )
    expect(timings).toEqual([
      { annotation: 'withClientTransaction', pipelined: true, batchSize: 2 },
      { annotation: 'first', pipelined: true, batchSize: 2 },
      { annotation: 'second' },
      { annotation: 'withClientTransaction' },
    ])
  })
})
