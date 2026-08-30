# @vouchington/postgres

Opinionated PostgreSQL runtime for Vouchington-style Node.js services.

The package is a factory on top of `pg`. It owns three connection pools, annotated query helpers,
bounded pipelined batches, transaction orchestration, cursor streaming, and a checksummed
migration runner. Product schema stays in the application.

## Install

```sh
pnpm add @vouchington/postgres
```

Requires Node.js 24 or newer.

## Quick start

```ts
import sql from 'sql-template-strings'
import { createPsql } from '@vouchington/postgres'

const psql = await createPsql({
  connectionString: process.env.DATABASE_URL!,
  readConnectionString: process.env.READ_DATABASE_URL,
})

await psql.read(sql`/* listUsers */ SELECT id FROM users LIMIT 1`)
await psql.withTransaction(async (query) => {
  await query(sql`/* insertUser */ INSERT INTO users (id) VALUES (${id})`)
})
await psql.close()
```

## Connection model

`createPsql()` creates three `pg` pools:

- `writePool` — primary writes and transaction clients
- `readPool` — replica-safe reads when `readConnectionString` is set
- `advisoryLockPool` — session advisory locks that must not consume `writePool`

Production defaults: `statement_timeout = 30s`, `idle_in_transaction_session_timeout = 10s`,
`jit=off`. Pool size comes from `PG_READ_POOL_MAX`, `PG_WRITE_POOL_MAX`, and
`PG_ADVISORY_LOCK_POOL_MAX` (`PG_POOL_MAX` is the compatibility fallback).

Every SQL string must start with a `/* functionName */` annotation outside tests. Do not set
`pipeline` on the shared pools; pipelining is enabled only inside `pipelineBatch()` (max 16
independent statements).

## Migrations

```ts
await psql.runMigrations('./migrations')
```

Fixed SQL files run in filename order. Already-applied files are checksummed. Concurrent index
builds use `-- migration-mode: online`. Extensions default to `pgcrypto`; pass
`migrationExtensions` to `createPsql()` to change that. pgvector type parsers are opt-in via
`vector: true`.

To run product views or config-driven steps in the same advisory lock as SQL migrations:

```ts
await psql.withMigrationSession(async (client) => {
  await psql.runMigrations('./migrations', { client, logger: console })
  await psql.write('/* dropLegacy */ DROP TABLE IF EXISTS leftover', { client })
})
```

## Schema snapshots

The explicit `@vouchington/postgres/pg-schema-snapshot` subpath reads PostgreSQL catalogs, builds a
stable structural snapshot, renders Markdown reference files, and detects index renames. It accepts
an injected query function, so the application owns its pools and schema policy.

```ts
import { buildSchemaSnapshot, readSchemaCatalog } from '@vouchington/postgres/pg-schema-snapshot'

const catalog = await readSchemaCatalog((sql) => psql.read(sql))
const snapshot = buildSchemaSnapshot(catalog, {
  partitionPolicies: new Map(),
  unboundedUnpartitionedTables: new Set(),
})
```

## Conventions

- UUIDv7 primary keys
- Every foreign key declares `ON DELETE`
- No `OFFSET` — use application cursors
- Authorization is application-layer; this runtime does not enable RLS
