import { parseSync } from '@libpg-query/parser'
import { escapeIdentifier } from 'pg'

export type ManagedViewDeclaration = {
  type: 'view' | 'materialized view'
  /** SQL-ready, schema-qualified and quoted only when required. */
  name: string
}

type RangeVarNode = { schemaname?: string; relname?: string; relpersistence?: string }
type StatementNode = {
  ViewStmt?: { view?: RangeVarNode }
  CreateTableAsStmt?: { into?: { rel?: RangeVarNode }; objtype?: string }
}

const PLAIN_IDENTIFIER = /^[a-z_][a-z0-9_$]*$/u

function quoteIdentifier(identifier: string): string {
  return PLAIN_IDENTIFIER.test(identifier) ? identifier : escapeIdentifier(identifier)
}

function declarationFor(
  type: ManagedViewDeclaration['type'],
  rel: RangeVarNode | undefined,
): ManagedViewDeclaration[] {
  if (!rel?.relname || rel.relpersistence === 't') return []
  const parts = rel.schemaname ? [rel.schemaname, rel.relname] : [rel.relname]
  return [{ type, name: parts.map(quoteIdentifier).join('.') }]
}

/**
 * Finds the persistent views and materialized views a SQL file creates. Temporary views are
 * ignored. SQL the parser rejects yields no declarations. Requires `loadSqlParserModule()`.
 */
export function extractViewDeclarations(sql: string): ManagedViewDeclaration[] {
  let statements: { stmt?: StatementNode }[]
  try {
    statements = parseSync(sql).stmts as { stmt?: StatementNode }[]
  } catch {
    return []
  }
  return statements.flatMap(({ stmt }) => {
    if (stmt?.ViewStmt) return declarationFor('view', stmt.ViewStmt.view)
    if (stmt?.CreateTableAsStmt?.objtype === 'OBJECT_MATVIEW') {
      return declarationFor('materialized view', stmt.CreateTableAsStmt.into?.rel)
    }
    return []
  })
}

export function uniqueViewDeclarations(
  declarations: readonly ManagedViewDeclaration[],
): ManagedViewDeclaration[] {
  const seen = new Set<string>()
  return declarations.filter((declaration) => {
    const key = `${declaration.type}:${declaration.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
