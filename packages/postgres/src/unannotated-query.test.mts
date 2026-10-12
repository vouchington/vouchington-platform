import sql from 'sql-template-strings'
import { describe, expect, it } from 'vitest'

import { allowUnannotatedQuery } from './prepared-statement-name.mts'
import { withPsql } from './test-helpers.mts'

const missingAnnotation = 'PostgreSQL query must start with an annotation comment'

describe('unannotated query opt-out', () => {
  it('rejects unannotated SQL on every path under the test runner', async () => {
    await withPsql(async (psql) => {
      await expect(psql.read('SELECT 1')).rejects.toThrow(missingAnnotation)
      await expect(psql.write(sql`SELECT ${1}::int`)).rejects.toThrow(missingAnnotation)
      await expect(psql.withTransaction((query) => query(sql`SELECT ${1}::int`))).rejects.toThrow(
        missingAnnotation,
      )
      await expect(psql.pipelineBatch([sql`SELECT ${1}::int`])).rejects.toThrow(missingAnnotation)
      await expect(async () => {
        for await (const row of psql.createAsyncGeneratorFromCursor('SELECT 1')) void row
      }).rejects.toThrow(missingAnnotation)
    })
  })

  it('runs opted-out fixture SQL on every path', async () => {
    await withPsql(async (psql) => {
      await expect(
        psql.write(
          allowUnannotatedQuery(
            'CREATE TEMP TABLE fixture_a (n int); CREATE TEMP TABLE fixture_b (n int)',
          ),
        ),
      ).resolves.toBeDefined()
      await expect(
        psql.read(allowUnannotatedQuery(sql`SELECT ${2}::int AS n`)),
      ).resolves.toMatchObject({ rows: [{ n: 2 }] })
      await expect(
        psql.write(allowUnannotatedQuery('SELECT $1::int AS n'), [8]),
      ).resolves.toMatchObject({ rows: [{ n: 8 }] })
      await expect(
        psql.write(allowUnannotatedQuery(sql`SELECT ${9}::int AS n`), [1]),
      ).resolves.toMatchObject({ rows: [{ n: 9 }] })
      await expect(
        psql.write(allowUnannotatedQuery(sql`SELECT ${3}::int AS n`.setName('fixture_named'))),
      ).resolves.toMatchObject({ rows: [{ n: 3 }] })
      await expect(
        psql.withTransaction((query) => query(allowUnannotatedQuery(sql`SELECT ${4}::int AS n`))),
      ).resolves.toMatchObject({ rows: [{ n: 4 }] })
      await expect(
        psql.pipelineBatch([
          allowUnannotatedQuery(sql`SELECT ${5}::int AS n`),
          '/* annotated */ SELECT 6 AS n',
        ]),
      ).resolves.toMatchObject([{ rows: [{ n: 5 }] }, { rows: [{ n: 6 }] }])
      const rows: unknown[] = []
      for await (const row of psql.createAsyncGeneratorFromCursor(
        allowUnannotatedQuery(sql`SELECT ${7}::int AS n`),
      )) {
        rows.push(row)
      }
      expect(rows).toEqual([{ n: 7 }])
    })
  })
})
