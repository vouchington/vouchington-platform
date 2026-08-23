import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterEach, describe, expect, it } from 'vitest'

import { withPsql } from './test-helpers.mts'

describe('createPsql session hooks', () => {
  const dirs: string[] = []
  afterEach(async () => {
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { force: true, recursive: true })))
  })

  it('runs migrations and writes on the advisory-lock client', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'vouchington-pg-session-'))
    dirs.push(folder)
    const table = `sess_${crypto.randomUUID().replaceAll('-', '').slice(0, 12)}`
    await writeFile(join(folder, `${table}.sql`), `CREATE TABLE ${table} (id integer PRIMARY KEY);`)
    await withPsql(async (psql) => {
      await psql.withMigrationSession(async (client) => {
        await psql.runMigrations(folder, { client, logger: { error() {}, log() {} } })
        await psql.write(`/* insert */ INSERT INTO ${table} (id) VALUES (1)`, { client })
      })
      await expect(
        psql.read(`/* count */ SELECT count(*)::int AS n FROM ${table}`),
      ).resolves.toMatchObject({ rows: [{ n: 1 }] })
      await psql.withMigrationSession(async () => undefined, {
        lockTimeoutMs: 5_000,
        statementTimeoutMs: 900_000,
      })
    })
  })

  it('captures query and pipeline inputs even when the hook throws', async () => {
    const captured: string[] = []
    await withPsql(
      async (psql) => {
        await psql.read('/* capturedRead */ SELECT 1')
        await psql.pipelineBatch(['/* capturedOk */ SELECT 1', '/* capturedPipe */ SELECT 2'])
        expect(captured).toEqual([
          '/* capturedRead */ SELECT 1',
          '/* capturedOk */ SELECT 1',
          '/* capturedPipe */ SELECT 2',
        ])
      },
      {
        onBeforeQuery: (input) => {
          const text = typeof input === 'string' ? input : input.text
          captured.push(text)
          if (text.includes('capturedPipe')) throw new Error('capture boom')
        },
      },
    )
  })
})
