import sql from 'sql-template-strings'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  allowUnannotatedQuery,
  assertLeadingQueryAnnotation,
  buildPreparedStatementName,
  extractLeadingQueryAnnotation,
} from './prepared-statement-name.mts'

describe('prepared statement names', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('extracts a leading annotation', () => {
    expect(extractLeadingQueryAnnotation('/* listUsers */ SELECT 1')).toBe('listUsers')
    expect(extractLeadingQueryAnnotation('SELECT 1')).toBeNull()
  })

  it('requires an annotation under test runners unless the caller opts out', () => {
    vi.stubEnv('NODE_ENV', 'test')
    vi.stubEnv('VITEST', 'true')
    const message = 'PostgreSQL query must start with an annotation comment'
    expect(() => assertLeadingQueryAnnotation('SELECT 1')).toThrow(message)
    expect(() => assertLeadingQueryAnnotation(sql`SELECT ${1}`)).toThrow(message)
    expect(() => assertLeadingQueryAnnotation('/* listUsers */ SELECT 1')).not.toThrow()
    expect(() => assertLeadingQueryAnnotation(sql`/* listUsers */ SELECT ${1}`)).not.toThrow()
    expect(() => assertLeadingQueryAnnotation(allowUnannotatedQuery('SELECT 1'))).not.toThrow()
    expect(() =>
      assertLeadingQueryAnnotation(allowUnannotatedQuery(sql`SELECT ${1}`)),
    ).not.toThrow()
  })

  it('opts out a string as a value-free statement and a statement in place', () => {
    const fromString = allowUnannotatedQuery('SELECT 1; SELECT 2')
    expect(fromString.text).toBe('SELECT 1; SELECT 2')
    expect(fromString.values).toEqual([])
    const statement = sql`SELECT ${1}`
    expect(allowUnannotatedQuery(statement)).toBe(statement)
  })

  it('builds names from annotations and explicit names', () => {
    expect(buildPreparedStatementName('SELECT 1', 'explicit')).toBe('explicit')
    expect(buildPreparedStatementName('SELECT 1')).toMatch(/^s_[0-9a-f]{32}$/)
    expect(buildPreparedStatementName('/* listUsers */ SELECT 1')).toMatch(
      /^s_listUsers_[0-9a-f]{32}$/,
    )
    expect(buildPreparedStatementName('/* !!! */ SELECT 1')).toMatch(/^s_[0-9a-f]{32}$/)
  })
})
