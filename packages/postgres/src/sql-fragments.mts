import sql, { type SQLStatement } from 'sql-template-strings'

const SQL_IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]*$/u

export function sqlOrGroup(predicates: readonly SQLStatement[]): SQLStatement {
  return sqlPredicateGroup('OR', predicates)
}

export function sqlAndGroup(predicates: readonly SQLStatement[]): SQLStatement {
  return sqlPredicateGroup('AND', predicates)
}

export function assertWhitelistedSqlIdentifier(
  identifier: string,
  allowed: ReadonlySet<string> | readonly string[],
  name: string,
): string {
  const allowedSet = isReadonlySet(allowed) ? allowed : new Set(allowed)
  if (!SQL_IDENTIFIER_PATTERN.test(identifier) || !allowedSet.has(identifier)) {
    throw new Error(`Invalid ${name}: ${identifier}`)
  }
  return identifier
}

function isReadonlySet(
  value: ReadonlySet<string> | readonly string[],
): value is ReadonlySet<string> {
  return value instanceof Set
}

function sqlPredicateGroup(
  operator: 'AND' | 'OR',
  predicates: readonly SQLStatement[],
): SQLStatement {
  if (predicates.length === 0) {
    throw new Error(`sql${operator === 'OR' ? 'Or' : 'And'}Group requires at least one predicate`)
  }

  const group = sql`(`
  predicates.forEach((predicate, index) => {
    if (index > 0) group.append(operator === 'OR' ? sql` OR ` : sql` AND `)
    group.append(predicate)
  })
  group.append(sql`)`)
  return group
}
