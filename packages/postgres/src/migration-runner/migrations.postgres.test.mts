import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { MigrationFileMissingError } from '../index.mts'
import { useIsolatedDatabase } from '../test-helpers.mts'
import { MigrationChecksumMismatchError } from './migration-checksum.mts'

const withPsql = useIsolatedDatabase()

describe('runMigrations', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await withPsql(async (psql) => {
      await psql.write('/* resetMigrationLedger */ DROP TABLE IF EXISTS migrations')
    })
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it('skips checksummed files and logs failures', async () => {
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
        await psql.runMigrations(folder, { logger })
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
    await expect(withPsql(async (psql) => psql.runMigrations(folder, { logger }))).rejects.toThrow(
      'already applied',
    )

    await writeFile(join(folder, file), createSql)
    await writeFile(join(folder, `${table}-fail.sql`), 'SELECT * FROM definitely_missing_relation;')
    await expect(withPsql(async (psql) => psql.runMigrations(folder, { logger }))).rejects.toThrow()
    expect(logs.some((line) => line.includes('failed'))).toBe(true)
  })

  it('rejects a legacy null checksum without changing the ledger', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-null-checksum-'))
    dirs.push(folder)
    const file = '001.sql'
    await writeFile(join(folder, file), 'SELECT 1;')

    await withPsql(async (psql) => {
      await psql.runMigrations(folder)
      const { rows: columns } = await psql.read<{ is_nullable: string }>(
        `/* checksumColumn */ SELECT is_nullable FROM information_schema.columns
         WHERE table_name = 'migrations' AND column_name = 'checksum'`,
      )
      expect(columns[0]?.is_nullable).toBe('NO')

      await psql.write(
        '/* legacyLedger */ ALTER TABLE migrations ALTER COLUMN checksum DROP NOT NULL',
      )
      await psql.write('/* legacyLedger */ UPDATE migrations SET checksum = NULL WHERE id = $1', [
        file,
      ])
      await expect(psql.runMigrations(folder)).rejects.toThrow('no recorded checksum')
      const { rows } = await psql.read<{ checksum: string | null }>(
        '/* legacyLedger */ SELECT checksum FROM migrations WHERE id = $1',
        [file],
      )
      expect(rows[0]?.checksum).toBeNull()
      await psql.write('/* legacyLedger */ DELETE FROM migrations WHERE id = $1', [file])
    })
  })

  it('rejects a null ledger checksum when its file or folder is missing', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-missing-checksum-file-'))
    dirs.push(folder)
    const file = '001.sql'
    await writeFile(join(folder, file), 'SELECT 1;')

    await withPsql(async (psql) => {
      await psql.runMigrations(folder)
      await psql.write(
        '/* legacyLedger */ ALTER TABLE migrations ALTER COLUMN checksum DROP NOT NULL',
      )
      await psql.write('/* legacyLedger */ UPDATE migrations SET checksum = NULL WHERE id = $1', [
        file,
      ])
      await rm(join(folder, file))
      await writeFile(join(folder, '002.sql'), 'SELECT 2;')

      await expect(psql.runMigrations(folder)).rejects.toThrow('no recorded checksum')
      const { rows } = await psql.read<{ id: string; checksum: string | null }>(
        '/* legacyLedger */ SELECT id, checksum FROM migrations WHERE id IN ($1, $2) ORDER BY id',
        [file, '002.sql'],
      )
      expect(rows).toEqual([{ id: file, checksum: null }])

      await expect(psql.runMigrations(`${folder}-missing`)).rejects.toThrow('no recorded checksum')
      await psql.write('/* legacyLedger */ DELETE FROM migrations WHERE id = $1', [file])
    })
  })

  it('rejects a missing applied file before applying a new file', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-missing-file-'))
    dirs.push(folder)
    await writeFile(join(folder, 'a.sql'), 'SELECT 1;')
    await writeFile(join(folder, 'b.sql'), 'SELECT 2;')

    await withPsql(async (psql) => {
      await psql.runMigrations(folder)
      await rm(join(folder, 'b.sql'))
      await writeFile(
        join(folder, 'c.sql'),
        'CREATE TABLE missing_file_preflight_new (id integer);',
      )

      await expect(psql.runMigrations(folder)).rejects.toMatchObject({
        name: 'MigrationFileMissingError',
        migration: 'b.sql',
        message: expect.stringContaining('Migration "b.sql"'),
      })
      await expect(psql.runMigrations(folder)).rejects.toBeInstanceOf(MigrationFileMissingError)
      const { rows } = await psql.read<{ id: string }>(
        '/* missingFileLedger */ SELECT id FROM migrations ORDER BY id',
      )
      expect(rows).toEqual([{ id: 'a.sql' }, { id: 'b.sql' }])
      expect(
        (
          await psql.read('/* missingFileEffect */ SELECT to_regclass($1)', [
            'missing_file_preflight_new',
          ])
        ).rows,
      ).toEqual([{ to_regclass: null }])
    })
  })

  it('rejects a later checksum mismatch before applying an earlier new file', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-late-checksum-'))
    dirs.push(folder)
    await writeFile(join(folder, 'b.sql'), 'SELECT 1;')

    await withPsql(async (psql) => {
      await psql.runMigrations(folder)
      await writeFile(join(folder, 'a.sql'), 'CREATE TABLE checksum_preflight_new (id integer);')
      await writeFile(join(folder, 'b.sql'), 'SELECT 3;')

      await expect(psql.runMigrations(folder)).rejects.toBeInstanceOf(
        MigrationChecksumMismatchError,
      )
      const { rows } = await psql.read<{ id: string }>(
        '/* mismatchPreflightLedger */ SELECT id FROM migrations ORDER BY id',
      )
      expect(rows).toEqual([{ id: 'b.sql' }])
      expect(
        (await psql.read('/* mismatchEffect */ SELECT to_regclass($1)', ['checksum_preflight_new']))
          .rows,
      ).toEqual([{ to_regclass: null }])
    })
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
