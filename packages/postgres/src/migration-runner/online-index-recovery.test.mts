import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { withPsql } from '../test-helpers.mts'

describe('online index recovery', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it('repairs an invalid unique index and writes the ledger only after it becomes valid', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-online-index-'))
    dirs.push(folder)
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    const table = `online_index_${suffix}`
    const index = `${table}_value_key`
    const migration = `${suffix}-index.sql`
    await writeFile(
      join(folder, migration),
      `/* replay after interrupted build */\n-- migration-mode: online\nCREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS ${index} ON ${table} (value);`,
    )

    await withPsql(async (psql) => {
      await psql.write(`/* setup */ CREATE TABLE ${table} (value integer NOT NULL)`)
      await psql.write(`/* setup */ INSERT INTO ${table} VALUES (1), (1)`)
      await expect(psql.runMigrations(folder)).rejects.toThrow()
      expect(
        (
          await psql.read<{ id: string }>('/* ledger */ SELECT id FROM migrations WHERE id = $1', [
            migration,
          ])
        ).rows,
      ).toEqual([])
      expect(
        (
          await psql.read<{ indisvalid: boolean }>(
            `/* invalid */ SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1`,
            [index],
          )
        ).rows,
      ).toEqual([{ indisvalid: false }])

      await psql.write(
        `/* repair */ DELETE FROM ${table} WHERE ctid IN (SELECT ctid FROM ${table} LIMIT 1)`,
      )
      await psql.runMigrations(folder)
      expect(
        (
          await psql.read<{ indisvalid: boolean }>(
            `/* valid */ SELECT i.indisvalid FROM pg_index i JOIN pg_class c ON c.oid = i.indexrelid WHERE c.relname = $1`,
            [index],
          )
        ).rows,
      ).toEqual([{ indisvalid: true }])
      expect(
        (
          await psql.read<{ id: string }>('/* ledger */ SELECT id FROM migrations WHERE id = $1', [
            migration,
          ])
        ).rows,
      ).toEqual([{ id: migration }])
    })
  })

  it('preserves a matching valid pre-existing index and refuses a mismatched one', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-online-index-'))
    dirs.push(folder)
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    const table = `online_index_${suffix}`
    const index = `${table}_value_idx`
    const migration = `${suffix}-index.sql`
    await writeFile(
      join(folder, migration),
      `-- migration-mode: online\nCREATE INDEX CONCURRENTLY IF NOT EXISTS ${index} ON ${table} (value DESC NULLS FIRST);`,
    )

    await withPsql(async (psql) => {
      await psql.write(
        `/* setup */ CREATE TABLE ${table} (value integer NOT NULL, other integer NOT NULL)`,
      )
      await psql.write(`/* setup */ CREATE INDEX ${index} ON ${table} (value DESC)`)
      const preserved = await indexOid(psql, index)
      await psql.runMigrations(folder)
      expect(await indexOid(psql, index)).toBe(preserved)
      expect(
        (await psql.read('/* exact */ SELECT 1 FROM migrations WHERE id = $1', [migration])).rows,
      ).toEqual([{ '?column?': 1 }])

      await psql.write('/* reset ledger */ DELETE FROM migrations WHERE id = $1', [migration])
      await psql.write(`/* mismatch */ DROP INDEX ${index}`)
      await psql.write(`/* mismatch */ CREATE INDEX ${index} ON ${table} (other)`)
      const mismatch = await indexOid(psql, index)
      await expect(psql.runMigrations(folder)).rejects.toThrow('Online index conflict')
      expect(await indexOid(psql, index)).toBe(mismatch)
      expect(
        (await psql.read('/* no ledger */ SELECT 1 FROM migrations WHERE id = $1', [migration]))
          .rows,
      ).toEqual([])
    })
  })

  it('preserves quoted complete definitions and protected collisions', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-online-index-'))
    dirs.push(folder)
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    const schema = `Online_${suffix}`
    const table = `Table_${suffix}`
    const index = `Index_${suffix}`
    const completeMigration = `${suffix}-complete.sql`
    const protectedMigration = `${suffix}-protected.sql`
    await writeFile(
      join(folder, completeMigration),
      `-- migration-mode: online\nCREATE INDEX CONCURRENTLY IF NOT EXISTS "${index}" ON "${schema}"."${table}" USING btree (value DESC NULLS LAST) INCLUDE (other) WITH (fillfactor = 70) WHERE other > 0;`,
    )
    await writeFile(
      join(folder, protectedMigration),
      `-- migration-mode: online\nCREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS "${table}_pkey" ON "${schema}"."${table}" (other);`,
    )

    await withPsql(async (psql) => {
      await psql.write(`/* setup */ CREATE SCHEMA "${schema}"`)
      await psql.write(
        `/* setup */ CREATE TABLE "${schema}"."${table}" (value text NOT NULL, other integer PRIMARY KEY)`,
      )
      await psql.write(
        `/* setup */ CREATE INDEX "${index}" ON "${schema}"."${table}" USING btree (value DESC NULLS LAST) INCLUDE (other) WITH (fillfactor = 70) WHERE other > 0`,
      )
      const complete = await indexOid(psql, index)
      await expect(psql.runMigrations(folder)).rejects.toThrow('Online index conflict')
      expect(await indexOid(psql, index)).toBe(complete)
      expect(
        (
          await psql.read('/* complete ledger */ SELECT id FROM migrations WHERE id = $1', [
            completeMigration,
          ])
        ).rows,
      ).toEqual([{ id: completeMigration }])
      expect(
        (
          await psql.read('/* protected ledger */ SELECT id FROM migrations WHERE id = $1', [
            protectedMigration,
          ])
        ).rows,
      ).toEqual([])
    })
  })

  it('rejects explicit tablespace before creating an index', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-online-index-'))
    dirs.push(folder)
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    const table = `online_index_${suffix}`
    const index = `${table}_idx`
    const migration = `${suffix}-tablespace.sql`
    await writeFile(
      join(folder, migration),
      `-- migration-mode: online\nCREATE INDEX CONCURRENTLY IF NOT EXISTS ${index} ON ${table} (value) TABLESPACE pg_default;`,
    )
    await withPsql(async (psql) => {
      await psql.write(`/* setup */ CREATE TABLE ${table} (value integer NOT NULL)`)
      await expect(psql.runMigrations(folder)).rejects.toMatchObject({ migration, index, table })
      expect((await psql.read('/* absent */ SELECT to_regclass($1)', [index])).rows).toEqual([
        { to_regclass: null },
      ])
      expect(
        (await psql.read('/* ledger */ SELECT id FROM migrations WHERE id = $1', [migration])).rows,
      ).toEqual([])
    })
  })

  it.each([
    ['opclass', 'value int4_ops'],
    ['collation', 'value COLLATE "C"'],
  ])('rejects explicit %s before DDL', async (_kind, clause) => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-online-index-'))
    dirs.push(folder)
    const suffix = crypto.randomUUID().replaceAll('-', '').slice(0, 12)
    const table = `online_index_${suffix}`
    const index = `${table}_idx`
    const migration = `${suffix}-clause.sql`
    await writeFile(
      join(folder, migration),
      `-- migration-mode: online\nCREATE INDEX CONCURRENTLY IF NOT EXISTS ${index} ON ${table} (${clause});`,
    )
    await withPsql(async (psql) => {
      await psql.write(`/* setup */ CREATE TABLE ${table} (value integer NOT NULL)`)
      await expect(psql.runMigrations(folder)).rejects.toMatchObject({ migration, index, table })
      expect((await psql.read('/* absent */ SELECT to_regclass($1)', [index])).rows).toEqual([
        { to_regclass: null },
      ])
      expect(
        (await psql.read('/* ledger */ SELECT id FROM migrations WHERE id = $1', [migration])).rows,
      ).toEqual([])
    })
  })
})

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
