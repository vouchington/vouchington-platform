import { parseSync, scanSync } from '@libpg-query/parser'
import { randomUUID } from 'node:crypto'
import type pg from 'pg'

import { isInTransaction } from '../transaction-probe.mts'

type RecordValue = Record<string, unknown>

export function extractIndexPredicate(sql: string, whereClause: unknown): string | undefined {
  if (!whereClause) return undefined
  const statements = parseSync(sql).stmts
  const statement = statements?.length === 1 ? statements[0] : undefined
  if (!statement) return undefined
  const statementStart = statement.stmt_location ?? 0
  const bytes = Buffer.from(sql, 'utf8')
  const end = statement.stmt_len === undefined ? bytes.length : statementStart + statement.stmt_len
  const start = scanSync(sql).tokens.find(
    (token) =>
      token.start >= statementStart && token.end <= end && token.text.toUpperCase() === 'WHERE',
  )?.end
  if (start === undefined) return undefined
  return bytes.subarray(start, end).toString('utf8').trim()
}

export async function predicatesEquivalent(
  client: pg.PoolClient,
  relation: string,
  requested: string | undefined,
  catalog: string | null,
): Promise<boolean> {
  if (!requested && !catalog) return true
  if (await isInTransaction(client))
    throw new Error('Online index predicate resolution requires a client outside a transaction')
  const name = `vouchington_predicates_${randomUUID().replaceAll('-', '')}`
  const view = `pg_temp.${quote(name)}`
  const requestedPredicate = requested ?? 'true'
  const catalogPredicate = catalog ?? 'true'
  await client.query('BEGIN')
  try {
    await client.query(
      `/* resolveOnlineIndexPredicate */ CREATE TEMP VIEW ${view} AS SELECT 1 AS marker FROM ${relation} WHERE (\n${requestedPredicate}\n) UNION ALL SELECT 2 AS marker FROM ${relation} WHERE (\n${catalogPredicate}\n)`,
    )
    const result = await client.query<{ definition: string }>(
      '/* resolveOnlineIndexPredicate */ SELECT pg_get_viewdef($1::regclass, false) definition',
      [view],
    )
    const equivalent = resolvedExpressionsEqual(result.rows[0]?.definition)
    await client.query('ROLLBACK')
    return equivalent
  } catch (error) {
    return rollbackAfterFailure(client, error)
  }
}

async function rollbackAfterFailure(client: pg.PoolClient, error: unknown): Promise<never> {
  try {
    await client.query('ROLLBACK')
  } catch {
    // Preserve the predicate-resolution failure when rollback also fails.
  }
  throw error
}

function resolvedExpressionsEqual(definition: string | undefined): boolean {
  if (!definition) return false
  const statement = (
    parseSync(definition).stmts?.[0]?.stmt as {
      SelectStmt?: {
        larg?: { whereClause?: unknown }
        rarg?: { whereClause?: unknown }
      }
    }
  )?.SelectStmt
  const requested = statement?.larg?.whereClause
  const catalog = statement?.rarg?.whereClause
  return (
    requested !== undefined &&
    catalog !== undefined &&
    JSON.stringify(canonical(requested)) === JSON.stringify(canonical(catalog))
  )
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (!isRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => key !== 'location' && !key.endsWith('_start') && !key.endsWith('_end'))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => [key, canonical(child)]),
  )
}
function isRecord(value: unknown): value is RecordValue {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}
function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
