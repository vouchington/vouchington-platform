import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { format } from 'node:util'

import { afterEach, describe, expect, it } from 'vitest'

import { useIsolatedDatabase } from '../test-helpers.mts'
import { describeMigrationError } from './migration-failure.mts'

const withPsql = useIsolatedDatabase()

const FILLER = Array.from({ length: 2_000 }, (_, index) => `-- filler line ${index}`).join('\n')
const FAILING_SQL = `${FILLER}\nSELECT * FROM definitely_missing_relation;`

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

  async function failingFolder(): Promise<string> {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-mig-fail-'))
    dirs.push(folder)
    await writeFile(join(folder, 'broken.sql'), FAILING_SQL)
    return folder
  }

  it('logs the migration and database error without the SQL by default', async () => {
    const folder = await failingFolder()
    const { errors, logger } = captureLogger()

    await expect(
      withPsql(async (psql) => psql.runMigrations(folder, { logger }), {
        env: { NODE_ENV: 'development' },
      }),
    ).rejects.toMatchObject({ code: '42P01' })

    expect(errors[0]).toMatch(
      /^ERROR: running migration broken\.sql failed: relation "definitely_missing_relation" does not exist\n {2}code: 42P01\n {2}position: \d+$/,
    )
    expect(errors[1]).toBe('Set DEBUG_MIGRATIONS=true to print the SQL of migration broken.sql.')
    expect(errors.join('\n')).not.toContain('filler line')
  })

  it('prints the full SQL after the error when DEBUG_MIGRATIONS is set', async () => {
    const folder = await failingFolder()
    const { errors, logger } = captureLogger()

    await expect(
      withPsql(async (psql) => psql.runMigrations(folder, { logger }), {
        env: { NODE_ENV: 'development', DEBUG_MIGRATIONS: 'true' },
      }),
    ).rejects.toMatchObject({ code: '42P01' })

    expect(errors[0]).toContain('failed: relation "definitely_missing_relation" does not exist')
    expect(errors[1]).toBe(FAILING_SQL)
  })
})

describe('describeMigrationError', () => {
  it('includes every PostgreSQL field that is present', () => {
    const error = Object.assign(new Error('could not load library'), {
      code: '58P01',
      detail: 'Symbol not found',
      hint: 'Restart the server',
      position: '',
      where: 'PL/pgSQL function f()',
    })
    expect(describeMigrationError(error)).toBe(
      [
        'could not load library',
        '  code: 58P01',
        '  detail: Symbol not found',
        '  hint: Restart the server',
        '  where: PL/pgSQL function f()',
      ].join('\n'),
    )
  })

  it('inspects values that are not errors', () => {
    expect(describeMigrationError('boom')).toBe("'boom'")
  })
})
