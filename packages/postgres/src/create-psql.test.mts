import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sql from 'sql-template-strings'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { createPsql } from './create-psql.mts'
import { resetPgTypeParsersForTest } from './type-parsers.mts'
import { databaseUrl, withPsql } from './test-helpers.mts'

describe('createPsql', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it('runs annotated reads, writes, and SQLStatement queries', async () => {
    await withPsql(async (psql) => {
      const result = await psql.read('/* selectOne */ SELECT 1 AS value')
      expect(result.rows).toEqual([{ value: 1 }])
      const named = await psql.write(sql`/* selectTwo */ SELECT ${2}::int AS value`)
      expect(named.rows).toEqual([{ value: 2 }])
      const delegated = await psql.query('/* delegated */ SELECT 3 AS value', {
        query: async (input, values) => psql.write(input, values),
      })
      expect(delegated.rows).toEqual([{ value: 3 }])
    })
  })

  it('commits transactions and rolls back failures', async () => {
    const table = `tx_${crypto.randomUUID().replaceAll('-', '')}`
    await withPsql(async (psql) => {
      await psql.write(`/* create */ CREATE TABLE ${table} (id int PRIMARY KEY)`)
      await psql.withTransaction(async (query) => {
        await query(`/* insert */ INSERT INTO ${table} (id) VALUES (1)`)
      })
      await expect(
        psql.read(`/* count */ SELECT count(*)::int AS n FROM ${table}`),
      ).resolves.toMatchObject({
        rows: [{ n: 1 }],
      })
      await expect(
        psql.withTransaction(async (query) => {
          await query(`/* insertFail */ INSERT INTO ${table} (id) VALUES (1)`)
        }),
      ).rejects.toThrow()
      await psql.write(`/* drop */ DROP TABLE ${table}`)
    })
  })

  it('pipelines independent selects and runs migrations', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-migrate-'))
    dirs.push(folder)
    const table = `mig_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
    await writeFile(join(folder, `${table}.sql`), `CREATE TABLE ${table} (id integer PRIMARY KEY);`)
    await withPsql(async (psql) => {
      const results = await psql.pipelineBatch([
        '/* one */ SELECT 1 AS value',
        '/* two */ SELECT 2 AS value',
      ])
      expect(results.map((result) => result.rows)).toEqual([[{ value: 1 }], [{ value: 2 }]])
      await psql.runMigrations(folder)
      await expect(
        psql.read(`/* exists */ SELECT to_regclass('${table}') IS NOT NULL AS ok`),
      ).resolves.toMatchObject({ rows: [{ ok: true }] })
      await psql.runMigrations(folder)
    })
  })

  it('streams cursor batches and closes twice', async () => {
    await withPsql(async (psql) => {
      const rows: number[] = []
      await psql.executeHandlerWithCursorInBatches(
        '/* cursor */ SELECT 1 AS n UNION ALL SELECT 2',
        {
          batchSize: 1,
          handler: async (batch) => {
            rows.push(...batch.map((row) => Number((row as { n: number }).n)))
          },
        },
      )
      expect(rows).toEqual([1, 2])
      const generated: number[] = []
      for await (const row of psql.createAsyncGeneratorFromCursor(
        '/* gen */ SELECT 3 AS n',
        undefined,
        { batchSize: 10 },
      )) {
        generated.push(Number((row as { n: number }).n))
      }
      expect(generated).toEqual([3])
      await psql.close()
    })
  })

  it('records query timing and optional vector registration', async () => {
    const timings: string[] = []
    const errors: Error[] = []
    resetPgTypeParsersForTest()
    const psql = await createPsql({
      connectionString: databaseUrl(),
      env: { ...process.env, NODE_ENV: 'test' },
      onQueryTiming: (input) => {
        timings.push(input.annotation ?? 'none')
        throw new Error('timing boom')
      },
      errorHandler: (error) => errors.push(error),
      vector: true,
      databaseName: 'postgres',
      onClose: (close) => close,
    })
    try {
      await psql.read('/* timed */ SELECT 1')
      expect(timings).toContain('timed')
    } finally {
      await psql.close()
    }
  })

  it('uses process.env when no env overlay is provided', async () => {
    const psql = await createPsql({ connectionString: databaseUrl() })
    try {
      expect(psql.writePool).toBeDefined()
    } finally {
      await psql.close()
    }
  })

  it('uses the default error handler when vector registration fails on a replica', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const onClose = vi.fn()
    const psql = await createPsql({
      connectionString: databaseUrl(),
      readConnectionString: 'postgres://127.0.0.1:1/does-not-exist',
      env: { ...process.env, NODE_ENV: 'test' },
      vector: true,
      onClose,
    })
    try {
      expect(onClose).toHaveBeenCalledWith(psql.close)
      expect(spy).toHaveBeenCalled()
    } finally {
      await psql.close()
      spy.mockRestore()
    }
  })

  it('parses bigint, date, numeric, and timestamp values', async () => {
    await withPsql(async (psql) => {
      const typed = await psql.read(`/* types */ SELECT
        1::bigint AS b,
        DATE '2020-01-01' AS d,
        1.5::numeric AS n,
        '2020-01-01 00:00:00'::timestamp AS ts,
        TIMESTAMPTZ '2020-01-01 00:00:00+00' AS tstz`)
      expect(typed.rows[0]).toMatchObject({
        b: '1',
        d: '2020-01-01',
        n: 1.5,
      })
      expect(typed.rows[0]?.ts).toBeInstanceOf(Date)
      expect(typed.rows[0]?.tstz).toBeInstanceOf(Date)
    })
  })
})
