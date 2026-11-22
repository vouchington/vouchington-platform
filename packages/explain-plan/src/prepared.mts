import type { ExplainClient } from './types.mts'

export function buildExplainPreparedStatementText(
  name: string,
  argumentSql: readonly string[],
  planOnly = false,
): string {
  const argumentsSql = argumentSql.join(', ')
  const executionSql = argumentsSql ? `EXECUTE ${name}(${argumentsSql})` : `EXECUTE ${name}`
  const options = planOnly ? 'FORMAT JSON' : 'ANALYZE, BUFFERS, WAL, FORMAT JSON'
  return `EXPLAIN (${options}) ${executionSql}`
}

/** Renders each value as a typed SQL literal using the prepared statement's parameter types. */
export async function buildPreparedArgumentSql(
  client: ExplainClient,
  preparedStatementName: string,
  values: readonly unknown[],
  tag: string,
): Promise<string[]> {
  const { rows } = await client.query(
    `${tag}
      SELECT parameter_type::text AS parameter_type
      FROM pg_prepared_statements
      CROSS JOIN LATERAL unnest(parameter_types) WITH ORDINALITY AS parameters(parameter_type, position)
      WHERE name = $1
      ORDER BY position`,
    [preparedStatementName],
  )
  const types = rows.map((row) => String(row['parameter_type']))
  if (types.length !== values.length) {
    throw new Error(
      `Prepared EXPLAIN parameter mismatch: expected ${types.length}, received ${values.length}`,
    )
  }
  if (types.length === 0) return []

  const quoteExpressions = types.map((type, index) => `quote_nullable($${index + 1}::${type})`)
  const { rows: literalRows } = await client.query(
    `${tag} SELECT ARRAY[${quoteExpressions.join(', ')}] AS literals`,
    [...values],
  )
  const literals = literalRows[0]!['literals'] as string[]
  return types.map((type, index) => `${literals[index]}::${type}`)
}
