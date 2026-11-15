import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { format } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { useIsolatedDatabase } from '../test-helpers.mts'

const withPsql = useIsolatedDatabase()

const FILLER = Array.from({ length: 2_000 }, (_, index) => `-- filler line ${index}`).join('\n')
const FAILING_SQL = [
  FILLER,
  'CREATE TABLE migration_failure_ok (id integer);',
  'SELECT *',
  'FROM definitely_missing_relation;',
  'CREATE TABLE migration_failure_after (id integer);',
].join('\n')

function captureLogger() {
  const errors: string[] = []
  const logger = {
    error: (...args: unknown[]) => {
      errors.push(format(...args))
    },
    log: () => {},
  }
  return { errors, logger }
}

describe('migration failure logging', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await withPsql(async (psql) => {
      await psql.write('/* resetMigrationLedger */ DROP TABLE IF EXISTS migrations')
    })
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  async function runFailing(
    sql: string,
    env: Record<string, string> = {},
    code = '42P01',
  ): Promise<string[]> {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-mig-fail-'))
    dirs.push(folder)
    await writeFile(join(folder, 'broken.sql'), sql)
    const { errors, logger } = captureLogger()
    await expect(
      withPsql(async (psql) => psql.runMigrations(folder, { logger }), {
        env: { NODE_ENV: 'development', DEBUG_MIGRATIONS: 'false', ...env },
      }),
    ).rejects.toMatchObject({ code })
    return errors
  }

  it('logs the database error and only the failing statement of a transactional migration', async () => {
    const errors = await runFailing(FAILING_SQL)

    expect(errors[0]).toMatch(
      /^ERROR: running migration broken\.sql failed: relation "definitely_missing_relation" does not exist\n {2}code: 42P01\n {2}position: \d+$/,
    )
    expect(errors[1]).toBe(
      [
        'Failing statement in broken.sql:',
        '  2002 | SELECT *',
        '> 2003 | FROM definitely_missing_relation',
      ].join('\n'),
    )
    expect(errors[2]).toBe(
      'Set DEBUG_MIGRATIONS=true to print the full SQL of migration broken.sql.',
    )
    expect(errors.join('\n')).not.toContain('filler line')
  })

  it('logs the failing statement of an online migration', async () => {
    const errors = await runFailing(
      [
        '-- migration-mode: online',
        'DROP INDEX CONCURRENTLY IF EXISTS migration_failure_missing_idx;',
        'DROP INDEX CONCURRENTLY IF EXISTS',
        '  migration_failure_a, migration_failure_b;',
      ].join('\n'),
      {},
      '0A000',
    )

    expect(errors[1]).toBe(
      [
        'Failing statement in broken.sql:',
        '  3 | DROP INDEX CONCURRENTLY IF EXISTS',
        '  4 |   migration_failure_a, migration_failure_b',
      ].join('\n'),
    )
  })

  it('prints the full SQL after the error when DEBUG_MIGRATIONS is set', async () => {
    const errors = await runFailing(FAILING_SQL, { DEBUG_MIGRATIONS: 'true' })

    expect(errors[0]).toContain('failed: relation "definitely_missing_relation" does not exist')
    expect(errors[1]).toBe(FAILING_SQL)
    expect(errors).toHaveLength(2)
  })
})
