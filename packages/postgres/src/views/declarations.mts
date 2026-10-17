import { parseSync } from '@libpg-query/parser'
import { escapeIdentifier } from 'pg'

export type ManagedViewDeclaration = {
  type: 'view' | 'materialized view'
  /** SQL-ready: every part quoted, so keywords and mixed case survive. */
  name: string
}

type RangeVarNode = { schemaname?: string; relname?: string; relpersistence?: string }
type StatementNode = {
  ViewStmt?: { view?: RangeVarNode }
  CreateTableAsStmt?: { into?: { rel?: RangeVarNode }; objtype?: string }
}

function declarationFor(
  type: ManagedViewDeclaration['type'],
  rel: RangeVarNode | undefined,
): ManagedViewDeclaration[] {
  if (!rel?.relname || rel.relpersistence === 't') return []
  const parts = rel.schemaname ? [rel.schemaname, rel.relname] : [rel.relname]
  return [{ type, name: parts.map((part) => escapeIdentifier(part)).join('.') }]
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
