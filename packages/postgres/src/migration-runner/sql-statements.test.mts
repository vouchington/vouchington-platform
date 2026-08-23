import { beforeAll, describe, expect, it } from 'vitest'

import { loadSqlParserModule, splitSqlStatements } from './sql-statements.mts'

describe('splitSqlStatements', () => {
  beforeAll(loadSqlParserModule)

  it('keeps a statement without a trailing semicolon', () => {
    expect(splitSqlStatements('SELECT 1')).toEqual(['SELECT 1'])
  })

  it('skips whitespace before a trailing semicolon', () => {
    expect(splitSqlStatements('SELECT 1\t;\nSELECT 2')).toEqual(['SELECT 1', 'SELECT 2'])
    expect(splitSqlStatements('SELECT 1\r;\nSELECT 2')).toEqual(['SELECT 1', 'SELECT 2'])
  })

  it('returns nothing for comments-only input', () => {
    expect(splitSqlStatements('-- just a comment')).toEqual([])
  })

  it('preserves UTF-8 comments between statements', () => {
    expect(splitSqlStatements('SELECT 1; -- →\nSELECT 2;')).toEqual(['SELECT 1', '-- →\nSELECT 2'])
  })

  it('falls back across quoted semicolons, escapes, and dollar quotes', () => {
    expect(splitSqlStatements("IF x = 'a;b' THEN y; END IF")).toEqual([
      "IF x = 'a;b' THEN y",
      'END IF',
    ])
    expect(splitSqlStatements("IF x = 'a''b;c' THEN y; END IF")).toEqual([
      "IF x = 'a''b;c' THEN y",
      'END IF',
    ])
    expect(splitSqlStatements('IF x THEN y $body$ a;b $body$; END IF')).toEqual([
      'IF x THEN y $body$ a;b $body$',
      'END IF',
    ])
    expect(splitSqlStatements('IF abc$tag$ THEN x; END IF')).toEqual([
      'IF abc$tag$ THEN x',
      'END IF',
    ])
    expect(splitSqlStatements('IF $body$ no close')).toEqual(['IF $body$ no close'])
    expect(splitSqlStatements('IF x THEN y;; END IF')).toEqual(['IF x THEN y', 'END IF'])
    expect(splitSqlStatements('IF x THEN y;')).toEqual(['IF x THEN y'])
  })
})
