import { beforeAll, describe, expect, it } from 'vitest'

import { prepareMigration } from './migration-mode.mts'
import { loadSqlParserModule, splitSqlStatements } from './sql-statements.mts'

describe('migration mode', () => {
  beforeAll(loadSqlParserModule)

  it('defaults to transactional mode', () => {
    expect(prepareMigration('CREATE TABLE example (id integer);')).toEqual({
      mode: 'transactional',
      statements: ['CREATE TABLE example (id integer);'],
    })
  })

  it('recognizes directives and rejects invalid ones', () => {
    expect(prepareMigration('-- migration-mode: transactional\nSELECT 1;').mode).toBe(
      'transactional',
    )
    expect(
      prepareMigration(
        '-- migration-mode: online\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx_example ON example (id);',
      ).mode,
    ).toBe('online')
    expect(() => prepareMigration('-- migration-mode: eventually\nSELECT 1;')).toThrow(
      'Unsupported migration mode "eventually"',
    )
    expect(() =>
      prepareMigration(`
-- migration-mode: transactional
-- migration-mode: online
SELECT 1;
`),
    ).toThrow('at most one migration-mode directive')
  })

  it('rejects transaction control and unsafe online statements', () => {
    expect(() => prepareMigration('BEGIN; SELECT 1;')).toThrow(
      'Managed migrations must not contain transaction control statements',
    )
    expect(() =>
      prepareMigration(
        '-- migration-mode: online\nCREATE INDEX CONCURRENTLY idx_example ON example (id);',
      ),
    ).toThrow('replay-safe')
    expect(() => prepareMigration('-- migration-mode: online\nSELECT 1;')).toThrow(
      'Online migration mode only supports concurrent index operations',
    )
    expect(() =>
      prepareMigration(
        '-- migration-mode: online\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx_example ON example (id);\nCREATE TABLE t (id int);',
      ),
    ).toThrow('Online migration mode only supports concurrent index operations')
    expect(() =>
      prepareMigration('CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_example ON example (id);'),
    ).toThrow('Concurrent index operations require "-- migration-mode: online"')
  })

  it('strips leading comments when classifying statements', () => {
    expect(
      prepareMigration(
        '-- migration-mode: online\n-- note\nCREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS idx_example ON example (id);',
      ).statements,
    ).toHaveLength(1)
    expect(
      prepareMigration('-- migration-mode: online\nDROP INDEX CONCURRENTLY IF EXISTS idx_example;')
        .mode,
    ).toBe('online')
    expect(prepareMigration('-- dangling comment').mode).toBe('transactional')
    expect(prepareMigration('/* note */ CREATE TABLE t (id int);').mode).toBe('transactional')
    expect(prepareMigration('/* unclosed CREATE TABLE t (id int)').mode).toBe('transactional')
    expect(prepareMigration('/* x */-- foo').mode).toBe('transactional')
  })
})

describe('splitSqlStatements', () => {
  beforeAll(loadSqlParserModule)

  it('splits parsed SQL and empty input', () => {
    expect(splitSqlStatements('')).toEqual([])
    expect(splitSqlStatements('SELECT 1; SELECT 2;')).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('falls back for unparseable fragments', () => {
    expect(splitSqlStatements("IF x = 'a;b' THEN y; END IF")).toContain('END IF')
  })
})
