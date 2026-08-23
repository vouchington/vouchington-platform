import { describe, expect, it } from 'vitest'
import sql from 'sql-template-strings'

import { assertWhitelistedSqlIdentifier, sqlAndGroup, sqlOrGroup } from './sql-fragments.mts'

describe('sql fragments', () => {
  it('groups predicates with AND and OR', () => {
    expect(sqlAndGroup([sql`a = 1`, sql`b = 2`]).text).toBe('(a = 1 AND b = 2)')
    expect(sqlOrGroup([sql`a = 1`, sql`b = 2`]).text).toBe('(a = 1 OR b = 2)')
  })

  it('rejects empty groups', () => {
    expect(() => sqlAndGroup([])).toThrow('sqlAndGroup requires at least one predicate')
    expect(() => sqlOrGroup([])).toThrow('sqlOrGroup requires at least one predicate')
  })

  it('allowlists identifiers from arrays and sets', () => {
    expect(assertWhitelistedSqlIdentifier('users', ['users'], 'table')).toBe('users')
    expect(assertWhitelistedSqlIdentifier('users', new Set(['users']), 'table')).toBe('users')
    expect(() => assertWhitelistedSqlIdentifier('Users', ['users'], 'table')).toThrow(
      'Invalid table',
    )
    expect(() => assertWhitelistedSqlIdentifier('users', ['posts'], 'table')).toThrow(
      'Invalid table',
    )
  })
})
