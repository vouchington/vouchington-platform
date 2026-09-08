import { parseSync } from '@libpg-query/parser'
import type pg from 'pg'
import {
  hasUnprovableIndexClause,
  OnlineIndexConflictError,
  requireIndexName,
  type OnlineIndexRow,
} from './online-index-errors.mts'
import { normalizeIndex } from './index-normalization.mts'
import {
  assertPredicateResolutionAvailable,
  extractIndexPredicate,
  predicatesEquivalent,
} from './predicate-resolution.mts'

type Statement = Record<string, unknown>
export async function recoverOnlineIndex(
  client: pg.PoolClient,
  migration: string,
  sql: string,
): Promise<void> {
  const requested = parseIndex(migration, sql),
    relation = requested.relation as Record<string, unknown>
  const table = await client.query<{ oid: number; nspname: string; relname: string }>(
    '/* recoverOnlineIndex */ SELECT c.oid, n.nspname, c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE c.oid = to_regclass($1)',
    [relationName(migration, relation)],
  )
  const target = table.rows[0]
  if (!target) throw new OnlineIndexConflictError('target relation does not resolve', { migration })
  const name = requireIndexName(requested, { migration, table: target.relname })
  if (requested.tableSpace)
    throw new OnlineIndexConflictError('explicit tablespace is unproven', {
      migration,
      table: target.relname,
      index: name,
    })
  if (hasUnprovableIndexClause(requested))
    throw new OnlineIndexConflictError('explicit opclass or collation is unproven', {
      migration,
      table: target.relname,
      index: name,
    })
  const requestedPredicate = extractIndexPredicate(sql, requested.whereClause)
  if (requested.whereClause && !requestedPredicate)
    throw new OnlineIndexConflictError('predicate source is not provable', {
      migration,
      table: target.relname,
      index: name,
    })
  if (requestedPredicate) await assertPredicateResolutionAvailable(client)
  const expected = normalizeIndex(requested, target),
    found = await readIndex(client, target, name)
  if (!found)
    return createAndVerify(client, migration, sql, target, name, expected, requestedPredicate)
  const equal = await equals(client, expected, requestedPredicate, found, target)
  if (equal && found.target_match && ready(found)) return
  if (equal && found.target_match && repairable(found)) {
    await client.query(
      `/* recoverOnlineIndex */ DROP INDEX CONCURRENTLY IF EXISTS ${quote(target.nspname)}.${quote(name)}`,
    )
    await client.query(sql)
    return verify(client, migration, target, name, expected, requestedPredicate)
  }
  throw new OnlineIndexConflictError(
    !equal
      ? 'existing index definition does not exactly match the requested definition'
      : found.relkind !== 'i'
        ? 'same-schema name belongs to a non-index relation'
        : 'existing index is unsafe to repair',
    { migration, table: target.relname, index: name },
  )
}
async function createAndVerify(
  client: pg.PoolClient,
  migration: string,
  sql: string,
  target: { oid: number; nspname: string; relname: string },
  name: string,
  expected: string,
  requestedPredicate: string | undefined,
): Promise<void> {
  await client.query(sql)
  await verify(client, migration, target, name, expected, requestedPredicate)
}
async function verify(
  client: pg.PoolClient,
  migration: string,
  target: { oid: number; nspname: string; relname: string },
  name: string,
  expected: string,
  requestedPredicate: string | undefined,
): Promise<void> {
  const found = await readIndex(client, target, name)
  if (
    !found ||
    !ready(found) ||
    !found.target_match ||
    !(await equals(client, expected, requestedPredicate, found, target))
  )
    throw new OnlineIndexConflictError('post-create catalog verification failed', {
      migration,
      table: target.relname,
      index: name,
    })
}

async function readIndex(
  client: pg.PoolClient,
  target: { oid: number; nspname: string },
  name: string,
): Promise<OnlineIndexRow | undefined> {
  const result = await client.query<OnlineIndexRow>(
    `/* recoverOnlineIndex */ SELECT pg_get_indexdef(c.oid) definition, pg_get_expr(i.indpred, i.indrelid) predicate, i.indisprimary, i.indisready, i.indisvalid, i.indislive, i.indisexclusion, i.indisreplident, c.relispartition, c.relkind, i.indrelid = $3 target_match, EXISTS (SELECT 1 FROM pg_constraint con WHERE con.conindid = c.oid) constrained, EXISTS (SELECT 1 FROM pg_depend d JOIN pg_extension e ON e.oid = d.refobjid WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e') extension_owned, EXISTS (SELECT 1 FROM pg_stat_progress_create_index p WHERE p.index_relid = c.oid) active FROM pg_class c LEFT JOIN pg_index i ON i.indexrelid = c.oid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relname = $2`,
    [target.nspname, name, target.oid],
  )
  return result.rows[0]
}

export function parseIndex(migration: string, sql: string): Statement {
  const value = (
    parseSync(sql).stmts?.[0]?.stmt as unknown as { IndexStmt?: Statement } | undefined
  )?.IndexStmt
  if (!value || !value.if_not_exists || !value.concurrent)
    throw new OnlineIndexConflictError('statement is not a replay-safe concurrent CREATE INDEX', {
      migration,
    })
  return value
}
export function relationName(migration: string, value: Record<string, unknown>): string {
  if (typeof value.relname !== 'string')
    throw new OnlineIndexConflictError('target relation name is not provable', { migration })
  return typeof value.schemaname === 'string'
    ? `${quote(value.schemaname)}.${quote(value.relname)}`
    : quote(value.relname)
}
async function equals(
  client: pg.PoolClient,
  expected: string,
  requestedPredicate: string | undefined,
  found: OnlineIndexRow,
  target: { nspname: string; relname: string },
): Promise<boolean> {
  let catalog: Statement
  try {
    catalog = parseIndex(
      '',
      found.definition.replace(
        /^CREATE (UNIQUE )?INDEX /,
        'CREATE $1INDEX CONCURRENTLY IF NOT EXISTS ',
      ),
    )
  } catch {
    return false
  }
  if (expected !== normalizeIndex(catalog, target)) return false
  return predicatesEquivalent(
    client,
    `${quote(target.nspname)}.${quote(target.relname)}`,
    requestedPredicate,
    found.predicate,
  )
}
function ready(row: OnlineIndexRow): boolean {
  return ordinary(row) && row.indisvalid && row.indisready && row.indislive && !row.active
}
function repairable(row: OnlineIndexRow): boolean {
  return ordinary(row) && !row.indisvalid && row.indislive && !row.active
}
function ordinary(row: OnlineIndexRow): boolean {
  return (
    row.relkind === 'i' &&
    !row.indisprimary &&
    !row.indisexclusion &&
    !row.indisreplident &&
    !row.relispartition &&
    !row.constrained &&
    !row.extension_owned
  )
}
function quote(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}
