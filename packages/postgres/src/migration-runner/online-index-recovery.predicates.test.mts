import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { withPsql } from '../test-helpers.mts'
import { predicatesEquivalent } from './predicate-resolution.mts'

describe('online index predicate recovery', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it.each([
    ['text equality', 'state text NOT NULL', "state = 'committed'"],
    ['parenthesized text equality', 'state text NOT NULL', "((state = 'committed'))"],
    ['unknown boolean literal', 'state text NOT NULL', "'false'"],
    ['constant true', 'state text NOT NULL', 'true'],
    [
      'enum IN list',
      'status online_index_status NOT NULL',
      "status IN ('delivered', 'suppressed')",
    ],
  ])('creates and ledgers a %s predicate index', async (_name, column, predicate) => {
    const fixture = await migrationFixture(column, predicate)
    await withPsql(async (psql) => {
      await setupTable(psql, fixture, column)
      await psql.runMigrations(fixture.folder)
      expect(await indexOid(psql, fixture.index)).not.toBe('')
      await expectLedger(psql, fixture.migration, true)
    })
  })

  it.each([
    ['text equality', 'state text NOT NULL', "state = 'committed'"],
    ['unknown boolean literal', 'state text NOT NULL', "'false'"],
    ['constant true', 'state text NOT NULL', 'true'],
    [
      'enum IN list',
      'status online_index_status NOT NULL',
      "status IN ('delivered', 'suppressed')",
    ],
  ])('preserves the OID of a matching %s predicate index', async (_name, column, predicate) => {
    const fixture = await migrationFixture(column, predicate)
    await withPsql(async (psql) => {
      await setupTable(psql, fixture, column)
      await psql.write(
        `/* setup */ CREATE INDEX ${fixture.index} ON ${fixture.table} (value) WHERE ${predicate}`,
      )
      const preserved = await indexOid(psql, fixture.index)
      await psql.runMigrations(fixture.folder)
      expect(await indexOid(psql, fixture.index)).toBe(preserved)
      await expectLedger(psql, fixture.migration, true)
    })
  })

  it('does not roll back a caller-owned transaction', async () => {
    await withPsql(async (psql) => {
      const client = await psql.writePool.connect()
      await client.query('BEGIN')
      try {
        await client.query('CREATE TEMP TABLE caller_work (value integer)')
        await client.query('INSERT INTO caller_work VALUES (1)')
        await expect(
          predicatesEquivalent(client, 'caller_work', 'value > 0', 'value > 0'),
        ).rejects.toThrow('outside a transaction')
        const result = await client.query<{ count: string }>('SELECT count(*) FROM caller_work')
        expect(result.rows[0]?.count).toBe('1')
      } finally {
        await client.query('ROLLBACK')
        client.release()
      }
    })
  })

  it('repairs an invalid partial index after predicate resolution', async () => {
    const fixture = await migrationFixture(
      'state text NOT NULL',
      "state = 'committed'",
      'value',
      true,
    )
    await withPsql(async (psql) => {
      await setupTable(psql, fixture, 'state text NOT NULL')
      await psql.write(
        `/* setup */ INSERT INTO ${fixture.table} VALUES (1, 'committed'), (1, 'committed'), (1, 'pending')`,
      )
      await expect(psql.runMigrations(fixture.folder)).rejects.toThrow()
      const invalid = await indexOid(psql, fixture.index)
      expect(invalid).not.toBe('')
      expect(await indexValidity(psql, fixture.index)).toBe(false)
      await expectLedger(psql, fixture.migration, false)
      await psql.write(
        `/* repair */ DELETE FROM ${fixture.table} WHERE ctid IN (SELECT ctid FROM ${fixture.table} WHERE state = 'committed' LIMIT 1)`,
      )
      await psql.runMigrations(fixture.folder)
      expect(await indexOid(psql, fixture.index)).not.toBe(invalid)
      expect(await indexValidity(psql, fixture.index)).toBe(true)
      await expectLedger(psql, fixture.migration, true)
    })
  })

  it.each([
    ['text literal', 'state text NOT NULL', "state = 'committed'", "state = 'pending'"],
    [
      'enum list',
      'status online_index_status NOT NULL',
      "status IN ('delivered', 'suppressed')",
      "status IN ('delivered', 'bounced')",
    ],
  ])('does not match a different %s predicate', async (_name, column, requested, existing) => {
    const fixture = await migrationFixture(column, requested)
    await withPsql(async (psql) => {
      await setupTable(psql, fixture, column)
      await psql.write(
        `/* setup */ CREATE INDEX ${fixture.index} ON ${fixture.table} (value) WHERE ${existing}`,
      )
      const preserved = await indexOid(psql, fixture.index)
      await expect(psql.runMigrations(fixture.folder)).rejects.toThrow('Online index conflict')
      expect(await indexOid(psql, fixture.index)).toBe(preserved)
      await expectLedger(psql, fixture.migration, false)
    })
  })

  it('preserves a semantically identical no-op predicate column cast', async () => {
    const fixture = await migrationFixture('state text NOT NULL', "state::text = 'committed'")
    await withPsql(async (psql) => {
      await setupTable(psql, fixture, 'state text NOT NULL')
      await psql.write(
        `/* setup */ CREATE INDEX ${fixture.index} ON ${fixture.table} (value) WHERE state = 'committed'`,
      )
      const preserved = await indexOid(psql, fixture.index)
      await psql.runMigrations(fixture.folder)
      expect(await indexOid(psql, fixture.index)).toBe(preserved)
      await expectLedger(psql, fixture.migration, true)
    })
  })

  it('does not strip an explicit cast around an index key expression', async () => {
    const fixture = await migrationFixture(
      'state text NOT NULL',
      "state = 'committed'",
      '(value::text)',
    )
    await withPsql(async (psql) => {
      await setupTable(psql, fixture, 'state text NOT NULL')
      await psql.write(
        `/* setup */ CREATE INDEX ${fixture.index} ON ${fixture.table} (value) WHERE state = 'committed'`,
      )
      const preserved = await indexOid(psql, fixture.index)
      await expect(psql.runMigrations(fixture.folder)).rejects.toThrow('Online index conflict')
      expect(await indexOid(psql, fixture.index)).toBe(preserved)
      await expectLedger(psql, fixture.migration, false)
    })
  })

  it.each([
    ['equality', "occurred_at = '2025-01-01'::date", "occurred_at = '2025-01-01'::timestamp"],
    [
      'IN elements',
      "occurred_at IN ('2025-01-01'::date, '2025-01-02'::date)",
      "occurred_at = ANY (ARRAY['2025-01-01'::timestamp, '2025-01-02'::timestamp])",
    ],
  ])('does not elide explicit source date casts in %s', async (_name, requested, existing) => {
    const fixture = await migrationFixture('occurred_at timestamp NOT NULL', requested)
    await withPsql(async (psql) => {
      await setupTable(psql, fixture, 'occurred_at timestamp NOT NULL')
      await psql.write(
        `/* setup */ CREATE INDEX ${fixture.index} ON ${fixture.table} (value) WHERE ${existing}`,
      )
      const preserved = await indexOid(psql, fixture.index)
      await expect(psql.runMigrations(fixture.folder)).rejects.toThrow('Online index conflict')
      expect(await indexOid(psql, fixture.index)).toBe(preserved)
      await expectLedger(psql, fixture.migration, false)
    })
  })

  it.each([
    [
      'equality',
      "occurred_at = '2025-01-01 12:00:00'",
      "occurred_at = '2025-01-01 12:00:00'::timestamp",
    ],
    [
      'IN elements',
      "occurred_at IN ('2025-01-01 12:00:00', '2025-01-02 12:00:00')",
      "occurred_at = ANY (ARRAY['2025-01-01 12:00:00'::timestamp, '2025-01-02 12:00:00'::timestamp])",
    ],
  ])(
    'does not mistake explicit catalog timestamp casts for inferred date casts in %s',
    async (_name, requested, existing) => {
      const fixture = await migrationFixture('occurred_at date NOT NULL', requested)
      await withPsql(async (psql) => {
        await setupTable(psql, fixture, 'occurred_at date NOT NULL')
        await psql.write(
          `/* setup */ CREATE INDEX ${fixture.index} ON ${fixture.table} (value) WHERE ${existing}`,
        )
        const preserved = await indexOid(psql, fixture.index)
        await expect(psql.runMigrations(fixture.folder)).rejects.toThrow('Online index conflict')
        expect(await indexOid(psql, fixture.index)).toBe(preserved)
        await expectLedger(psql, fixture.migration, false)
      })
    },
  )

  async function migrationFixture(
    column: string,
    predicate: string,
    key = 'value',
    unique = false,
  ) {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-online-index-predicate-'))
    dirs.push(folder)
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    const table = `online_index_predicate_${suffix}`
    const index = `${table}_idx`
    const migration = `${suffix}-index.sql`
    await writeFile(
      join(folder, migration),
      `-- migration-mode: online\nCREATE ${unique ? 'UNIQUE ' : ''}INDEX CONCURRENTLY IF NOT EXISTS ${index} ON ${table} (${key}) WHERE ${predicate};`,
    )
    return { enumType: `${table}_status`, folder, index, migration, table }
  }
})

async function setupTable(
  psql: Parameters<typeof withPsql>[0] extends (psql: infer Psql) => unknown ? Psql : never,
  fixture: { enumType: string; table: string },
  column: string,
): Promise<void> {
  const definition = column.replace('online_index_status', fixture.enumType)
  if (definition !== column)
    await psql.write(
      `/* setup */ CREATE TYPE ${fixture.enumType} AS ENUM ('delivered', 'suppressed', 'bounced')`,
    )
  await psql.write(
    `/* setup */ CREATE TABLE ${fixture.table} (value integer NOT NULL, ${definition})`,
  )
}

async function expectLedger(
  psql: Parameters<typeof withPsql>[0] extends (psql: infer Psql) => unknown ? Psql : never,
  migration: string,
  present: boolean,
): Promise<void> {
  const rows = (
    await psql.read('/* ledger */ SELECT id FROM migrations WHERE id = $1', [migration])
  ).rows
  expect(rows).toHaveLength(present ? 1 : 0)
}

async function indexOid(
  psql: Parameters<typeof withPsql>[0] extends (psql: infer Psql) => unknown ? Psql : never,
  index: string,
): Promise<string> {
  const result = await psql.read<{ oid: string }>(
    '/* indexOid */ SELECT oid::text FROM pg_class WHERE relname = $1',
    [index],
  )
  return result.rows[0]?.oid ?? ''
}

async function indexValidity(
  psql: Parameters<typeof withPsql>[0] extends (psql: infer Psql) => unknown ? Psql : never,
  index: string,
): Promise<boolean | undefined> {
  const result = await psql.read<{ indisvalid: boolean }>(
    '/* indexValidity */ SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1',
    [index],
  )
  return result.rows[0]?.indisvalid
}
