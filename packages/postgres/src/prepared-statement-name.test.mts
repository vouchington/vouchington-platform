import { describe, expect, it } from 'vitest'

import {
  assertLeadingQueryAnnotation,
  buildPreparedStatementName,
  extractLeadingQueryAnnotation,
} from './prepared-statement-name.mts'

describe('prepared statement names', () => {
  it('extracts a leading annotation', () => {
    expect(extractLeadingQueryAnnotation('/* listUsers */ SELECT 1')).toBe('listUsers')
    expect(extractLeadingQueryAnnotation('SELECT 1')).toBeNull()
  })

  it('skips the annotation requirement in tests', () => {
    expect(() => assertLeadingQueryAnnotation('SELECT 1', { NODE_ENV: 'test' })).not.toThrow()
    expect(() => assertLeadingQueryAnnotation('SELECT 1', { VITEST: 'true' })).not.toThrow()
  })

  it('requires an annotation outside tests', () => {
    expect(() => assertLeadingQueryAnnotation('SELECT 1', { NODE_ENV: 'production' })).toThrow(
      'PostgreSQL query must start with an annotation comment',
    )
    expect(() =>
      assertLeadingQueryAnnotation('/* listUsers */ SELECT 1', { NODE_ENV: 'production' }),
    ).not.toThrow()
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
