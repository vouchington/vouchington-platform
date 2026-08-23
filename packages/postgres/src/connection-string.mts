type DatabaseEnv = Partial<
  Pick<
    NodeJS.ProcessEnv,
    | 'DATABASE_HOST'
    | 'DATABASE_NAME'
    | 'DATABASE_PASSWORD'
    | 'DATABASE_PORT'
    | 'DATABASE_SSLMODE'
    | 'DATABASE_URL'
    | 'DATABASE_USER'
    | 'DOCKER_HOST_IP'
  >
>

const databasePartNames = [
  'DATABASE_HOST',
  'DATABASE_NAME',
  'DATABASE_PASSWORD',
  'DATABASE_USER',
] as const

export function withLibpqCompat(url: string): string {
  if (!url.includes('sslmode=require') || url.includes('uselibpqcompat')) return url
  return `${url}&uselibpqcompat=true`
}

export function resolveDatabaseConnectionString(
  env: DatabaseEnv = process.env,
  defaultDatabaseName = 'postgres',
): string {
  if (databasePartNames.every((name) => env[name])) {
    return buildDatabaseConnectionStringFromParts(env)
  }

  if (env.DATABASE_URL) return env.DATABASE_URL

  if (databasePartNames.some((name) => env[name])) {
    return buildDatabaseConnectionStringFromParts(env)
  }

  const host = env.DOCKER_HOST_IP ? `postgres@${env.DOCKER_HOST_IP}` : 'localhost'
  return `postgres://${host}/${defaultDatabaseName}`
}

export function buildDatabaseConnectionStringFromParts(env: DatabaseEnv): string {
  const missing = databasePartNames.filter((name) => !env[name])
  if (missing.length > 0) {
    throw new Error(`Missing database connection env vars: ${missing.join(', ')}`)
  }

  const url = new URL('postgresql://localhost')
  url.hostname = env.DATABASE_HOST!
  url.port = env.DATABASE_PORT || '5432'
  url.username = env.DATABASE_USER!
  url.password = env.DATABASE_PASSWORD!
  url.pathname = `/${env.DATABASE_NAME!}`
  url.searchParams.set('sslmode', env.DATABASE_SSLMODE || 'require')
  return url.toString()
}
