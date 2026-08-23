import sql from 'sql-template-strings'
import { describe, expect, it } from 'vitest'

import { withPsql } from './test-helpers.mts'

describe('query clients', () => {
  it('reads, writes, and reports failures with values', async () => {
    await withPsql(
      async (psql) => {
        await expect(psql.write('/* params */ SELECT $1::int AS n', [9])).resolves.toMatchObject({
          rows: [{ n: 9 }],
        })
        const client = await psql.writePool.connect()
        try {
          await expect(psql.query('/* client */ SELECT 1 AS n', { client })).resolves.toMatchObject(
            {
              rows: [{ n: 1 }],
            },
          )
          await expect(
            psql.query('/* clientFail */ SELECT * FROM definitely_missing_relation', { client }),
          ).rejects.toThrow()
        } finally {
          client.release()
        }
        await expect(psql.read('SELECT 1 AS n')).resolves.toMatchObject({ rows: [{ n: 1 }] })
        await expect(
          psql.query('/* delegatedFail */ SELECT 1', {
            query: async () => {
              throw new Error('delegated')
            },
          }),
        ).rejects.toThrow('delegated')
        await expect(
          psql.read('/* missing */ SELECT * FROM definitely_missing_relation'),
        ).rejects.toThrow()
        await expect(
          psql.write('/* missingValues */ SELECT * FROM definitely_missing_relation', [1]),
        ).rejects.toThrow()
      },
      {
        onQueryTiming: (input) => {
          if (input.error) throw new Error('timing on error')
        },
      },
    )
  })
})

describe('transactions', () => {
  it('reuses an existing transaction query and client', async () => {
    await withPsql(async (psql) => {
      await psql.withTransaction(async (query) => {
        await psql.withTransactionOptions({ query }, async (inner) => {
          expect(inner).toBe(query)
          await inner('/* nested */ SELECT 1')
        })
      })

      const client = await psql.writePool.connect()
      try {
        await client.query('BEGIN')
        await psql.withTransactionOptions({ client }, async (query) => {
          await query('/* already */ SELECT 1')
        })
        await expect(
          psql.withTransactionOptions({ client }, async () => {
            throw new Error('already-in-tx')
          }),
        ).rejects.toThrow('already-in-tx')
        await client.query('ROLLBACK')
      } finally {
        client.release()
      }

      await psql.withTransactionOptions({ client: psql.writePool }, async (query) => {
        await query('/* pool */ SELECT 1')
      })
      await psql.withTransactionOptions({}, async (query) => {
        await query('/* fresh */ SELECT 1')
      })
    })
  })

  it('surfaces a queued Error after the handler returns', async () => {
    await withPsql(async (psql) => {
      await expect(
        psql.withTransaction(async (query) => {
          const pending = query('/* boom */ SELECT * FROM definitely_missing_relation')
          return pending
        }),
      ).rejects.toThrow()
    })
  })
})

describe('cursors', () => {
  it('streams SQLStatement rows and honors abort and validation', async () => {
    await withPsql(async (psql) => {
      const generated: number[] = []
      for await (const row of psql.createAsyncGeneratorFromCursor(
        sql`/* stmt */ SELECT ${5}::int AS n`,
      )) {
        generated.push(Number((row as { n: number }).n))
      }
      expect(generated).toEqual([5])

      const fromValues: number[] = []
      for await (const row of psql.createAsyncGeneratorFromCursor(
        '/* values */ SELECT $1::int AS n',
        [6],
        {
          readOnly: false,
          batchSize: 1,
        },
      )) {
        fromValues.push(Number((row as { n: number }).n))
      }
      expect(fromValues).toEqual([6])

      const aborted = new AbortController()
      aborted.abort()
      const rows: unknown[] = []
      for await (const row of psql.createAsyncGeneratorFromCursor('/* abort */ SELECT 1', {
        abortSignal: aborted.signal,
      })) {
        rows.push(row)
      }
      expect(rows).toEqual([])

      await expect(
        psql.executeHandlerWithCursorInBatches('/* handler */ SELECT 1', {
          batchSize: 0,
          handler: async () => {},
        }),
      ).rejects.toThrow('batchSize must be a positive integer')
      await expect(
        psql.executeHandlerWithCursorInBatches('/* handler */ SELECT 1'),
      ).rejects.toThrow('handler is required')
      await expect(
        (async () => {
          for await (const _row of psql.createAsyncGeneratorFromCursor(
            '/* bad */ SELECT * FROM definitely_missing_relation',
          )) {
            void _row
          }
        })(),
      ).rejects.toThrow()

      const controller = new AbortController()
      await psql.executeHandlerWithCursorInBatches(
        '/* abortLoop */ SELECT 1 AS n UNION ALL SELECT 2',
        {
          batchSize: 1,
          abortSignal: controller.signal,
          handler: async () => {
            controller.abort()
          },
        },
      )
    })
  })
})
