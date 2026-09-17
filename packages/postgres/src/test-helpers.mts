import pg from 'pg'
import { afterAll, beforeAll } from 'vitest'

import { createPsql, type Psql } from './create-psql.mts'

type WithPsqlOptions = Parameters<typeof createPsql>[0] extends infer T
  ? T extends { connectionString: string }
    ? Omit<T, 'connectionString'> & { connectionString?: string }
    : never
  : never

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
}

export async function withPsql<Result>(
  run: (psql: Psql) => Promise<Result>,
  options: WithPsqlOptions = {},
): Promise<Result> {
  const psql = await createPsql({
    ...options,
    connectionString: options.connectionString ?? databaseUrl(),
    env: { ...process.env, NODE_ENV: 'test', ...options.env },
  })
  try {
    return await run(psql)
  } finally {
    await psql.close()
  }
}

/**
 * Runs the calling test file against its own database and returns a `withPsql`
 * bound to it.
 *
 * Migration sessions serialize on one advisory lock per database, and
 * `CREATE INDEX CONCURRENTLY` waits on every older snapshot in that database --
 * including sessions queued on the same lock. Files that share a database
 * across parallel workers or concurrent runs therefore deadlock.
 */
export function useIsolatedDatabase(): typeof withPsql {
  const name = `vouchington_test_${crypto.randomUUID().replaceAll('-', '')}`
  const url = new URL(databaseUrl())
  url.pathname = `/${name}`
  beforeAll(() => withAdminClient(`CREATE DATABASE ${name}`))
  afterAll(() => withAdminClient(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`))
  return (run, options) => withPsql(run, { connectionString: url.href, ...options })
}

async function withAdminClient(statement: string): Promise<void> {
  const client = new pg.Client({ connectionString: databaseUrl() })
  await client.connect()
  try {
    await client.query(statement)
  } finally {
    await client.end()
  }
}
