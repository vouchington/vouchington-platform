import { createPsql, type Psql } from './create-psql.mts'

export function databaseUrl(): string {
  return process.env.DATABASE_URL ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres'
}

export async function withPsql<Result>(
  run: (psql: Psql) => Promise<Result>,
  options: Parameters<typeof createPsql>[0] extends infer T
    ? T extends { connectionString: string }
      ? Omit<T, 'connectionString'> & { connectionString?: string }
      : never
    : never = {},
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
