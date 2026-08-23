import pg from 'pg'
import pgvector from 'pgvector'
import sql from 'sql-template-strings'

import type { ErrorHandler } from './types.mts'

export async function registerPgVectorTypes(connectionUrl: string): Promise<void> {
  const client = new pg.Client({
    connectionString: connectionUrl,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 5_000,
  })

  await client.connect()

  try {
    const {
      rows: [row],
    } = await client.query<{
      vector_oid: number | null
      halfvec_oid: number | null
      sparsevec_oid: number | null
    }>(sql`/* registerPgVectorTypes */
      SELECT
        (SELECT oid FROM pg_type WHERE typname = 'vector') AS vector_oid,
        (SELECT oid FROM pg_type WHERE typname = 'halfvec') AS halfvec_oid,
        (SELECT oid FROM pg_type WHERE typname = 'sparsevec') AS sparsevec_oid
    `)

    if (!row?.vector_oid) {
      throw new Error('vector type not found in the database')
    }

    pg.types.setTypeParser(row.vector_oid, 'text', pgvector.fromSql)
    if (row.halfvec_oid) pg.types.setTypeParser(row.halfvec_oid, 'text', pgvector.fromSql)
    if (row.sparsevec_oid) pg.types.setTypeParser(row.sparsevec_oid, 'text', pgvector.fromSql)
  } finally {
    await client.end()
  }
}

export function ignoreMissingVectorType(error: Error, errorHandler: ErrorHandler): void {
  if (error.message.includes('vector type not found in the database')) return
  errorHandler(error)
}
