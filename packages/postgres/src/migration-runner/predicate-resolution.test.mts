import { parseSync } from '@libpg-query/parser'
import { beforeAll, describe, expect, it } from 'vitest'

import {
  assertPredicateResolutionAvailable,
  extractIndexPredicate,
  predicatesEquivalent,
} from './predicate-resolution.mts'
import { loadSqlParserModule } from './sql-statements.mts'

describe('online index predicate extraction', () => {
  beforeAll(loadSqlParserModule)

  it('uses PostgreSQL byte locations through trailing comments', () => {
    const sql = `-- →\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON widgets (id)\nWHERE state = 'committed' -- retained\n;`
    expect(extractIndexPredicate(sql, parseWhere(sql))).toBe("state = 'committed' -- retained")
  })

  it('preserves grouping parentheses omitted from the expression AST', () => {
    const sql =
      "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON widgets (id) WHERE ((state = 'committed'))"
    expect(extractIndexPredicate(sql, parseWhere(sql))).toBe("((state = 'committed'))")
  })

  it('returns no predicate for an index without WHERE', () => {
    const sql = 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON widgets (id)'
    expect(extractIndexPredicate(sql, parseWhere(sql))).toBeUndefined()
  })

  it('fails closed for ambiguous statements and recognizes lowercase WHERE', () => {
    const sql = 'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON widgets (id) WHERE id > 0'
    expect(extractIndexPredicate(`${sql}; SELECT 1`, parseWhere(sql))).toBeUndefined()
    expect(extractIndexPredicate(sql.replace('WHERE', 'where'), {})).toBe('id > 0')
    expect(
      extractIndexPredicate('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON widgets (id)', {}),
    ).toBeUndefined()
  })

  it('compares absent predicates without catalog work', async () => {
    const client = fakeClient([])
    await expect(predicatesEquivalent(client, 'widgets', undefined, null)).resolves.toBe(true)
  })

  it.each([
    [undefined, false],
    ['SELECT 1 WHERE true', false],
    ['SELECT 1 WHERE true UNION ALL SELECT 2 WHERE false', false],
    ['SELECT 1 WHERE true UNION ALL SELECT 2 WHERE true', true],
  ])('compares resolved view definition %#', async (definition, expected) => {
    const client = fakeClient([
      { rows: [] },
      { rows: [] },
      { rows: definition ? [{ definition }] : [] },
      { rows: [] },
    ])
    await expect(predicatesEquivalent(client, 'widgets', 'id > 0', 'id > 0')).resolves.toBe(
      expected,
    )
  })

  it('keeps an absent requested predicate distinct from a catalog partial index', async () => {
    await expect(predicatesEquivalent(fakeClient([]), 'widgets', undefined, 'true')).resolves.toBe(
      false,
    )
  })

  it('rejects missing database TEMPORARY privilege before BEGIN', async () => {
    const calls: string[] = []
    const client = {
      query: async (query: string) => {
        calls.push(query)
        if (query.startsWith('SAVEPOINT')) throw noTransactionError()
        return { rows: [{ allowed: false }] }
      },
    } as never
    await expect(assertPredicateResolutionAvailable(client)).rejects.toThrow('TEMPORARY privilege')
    expect(calls.some((query) => query === 'BEGIN')).toBe(false)
  })

  it('rejects a client already inside a transaction', async () => {
    const calls: string[] = []
    const client = { query: async (query: string) => (calls.push(query), { rows: [] }) } as never
    await expect(assertPredicateResolutionAvailable(client)).rejects.toThrow(
      'outside a transaction',
    )
    expect(calls).toHaveLength(2)
    expect(calls.every((query) => query.includes('SAVEPOINT'))).toBe(true)
  })

  it.each([false, true])(
    'propagates resolver failures when rollback failure is %s',
    async (rollbackFails) => {
      const failure = new Error('catalog unavailable')
      const calls: string[] = []
      const client = {
        query: async (query: string) => {
          calls.push(query)
          if (query.includes('pg_get_viewdef')) throw failure
          if (query === 'ROLLBACK' && rollbackFails) throw new Error('rollback unavailable')
          return { rows: [] }
        },
      } as never
      await expect(predicatesEquivalent(client, 'widgets', 'id > 0', 'id > 0')).rejects.toBe(
        failure,
      )
      expect(calls.at(-1)).toBe('ROLLBACK')
    },
  )
})

function parseWhere(sql: string): unknown {
  const statement = parseStatement(sql)
  return statement?.whereClause
}

function fakeClient(replies: { rows: unknown[] }[]) {
  return {
    query: async () => replies.shift() ?? { rows: [] },
  } as never
}

function noTransactionError(): Error {
  return Object.assign(new Error('no active transaction'), { code: '25P01' })
}

function parseStatement(sql: string): { whereClause?: unknown } | undefined {
  return (parseSync(sql).stmts?.[0]?.stmt as { IndexStmt?: { whereClause?: unknown } } | undefined)
    ?.IndexStmt
}
