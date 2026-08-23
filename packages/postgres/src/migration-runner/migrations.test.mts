import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { withPsql } from '../test-helpers.mts'

describe('runMigrations', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it('skips applied files, backfills null checksums, and logs failures', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-mig-'))
    dirs.push(folder)
    const table = `mig_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
    const file = `${table}.sql`
    const createSql = `CREATE TABLE ${table} (id integer PRIMARY KEY);`
    await writeFile(join(folder, file), createSql)
    const logs: string[] = []
    const logger = {
      log: (...args: unknown[]) => {
        logs.push(String(args[0]))
      },
      error: (...args: unknown[]) => {
        logs.push(String(args[0]))
      },
    }

    await withPsql(
      async (psql) => {
        await psql.runMigrations(folder, logger)
        await psql.write('/* nullChecksum */ UPDATE migrations SET checksum = NULL WHERE id = $1', [
          file,
        ])
        await psql.runMigrations(folder, {
          logger,
          lockTimeoutMs: 5_000,
          statementTimeoutMs: 5_000,
        })
        const client = await psql.writePool.connect()
        try {
          await psql.runMigrations(folder, { client, logger })
        } finally {
          client.release()
        }
      },
      { env: { NODE_ENV: 'development', DEBUG_MIGRATIONS: 'true' } },
    )
    expect(logs.some((line) => line.includes('DEBUG'))).toBe(true)

    await writeFile(join(folder, file), 'SELECT 1;')
    await expect(withPsql(async (psql) => psql.runMigrations(folder, logger))).rejects.toThrow(
      'already applied',
    )

    await writeFile(join(folder, file), createSql)
    await writeFile(join(folder, `${table}-fail.sql`), 'SELECT * FROM definitely_missing_relation;')
    await expect(withPsql(async (psql) => psql.runMigrations(folder, logger))).rejects.toThrow()
    expect(logs.some((line) => line.includes('failed'))).toBe(true)
  })

  it('runs an empty folder with a custom extension list', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-empty-'))
    dirs.push(folder)
    await withPsql(async (psql) => psql.runMigrations(folder), {
      migrationExtensions: ['pgcrypto'],
    })
  })

  it('uses the silent logger for empty options and failures', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-silent-'))
    dirs.push(folder)
    await writeFile(join(folder, 'fail.sql'), 'SELECT * FROM definitely_missing_relation;')
    await expect(withPsql(async (psql) => psql.runMigrations(folder, {}))).rejects.toThrow()
    await withPsql(async (psql) => psql.runMigrations(folder + '-missing', {}), {
      env: { NODE_ENV: 'development', DEBUG_MIGRATIONS: 'true' },
    })
  })
})
