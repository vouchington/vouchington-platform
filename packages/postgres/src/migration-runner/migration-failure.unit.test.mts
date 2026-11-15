import { format } from 'node:util'

import { beforeAll, describe, expect, it } from 'vitest'

import { failedStatementOf, rememberFailedStatement } from './failed-statement.mts'
import { describeMigrationError, logMigrationFailure } from './migration-failure.mts'
import { excerptFailingStatement } from './migration-sql-excerpt.mts'
import { loadSqlParserModule } from './sql-statements.mts'

beforeAll(async () => {
  await loadSqlParserModule()
})

function pgError(code: string, position?: number): Error {
  return Object.assign(new Error('failed'), {
    code,
    position: position === undefined ? undefined : String(position),
  })
}

function logFailure(sql: string, error: unknown): string[] {
  const errors: string[] = []
  const logger = { error: (...args: unknown[]) => void errors.push(format(...args)), log: () => {} }
  logMigrationFailure(logger, 'm.sql', sql, error, false)
  return errors
}

describe('logMigrationFailure', () => {
  it('prints no SQL for server and connection errors', () => {
    const errors = logFailure('SELECT 1;', pgError('58P01', 1))
    expect(errors[1]).toBe(
      'SQLSTATE class 58 points to the database server or connection, not the SQL of migration m.sql.',
    )
    expect(errors).toHaveLength(2)
  })

  it.each([
    ['a Node error code', Object.assign(new Error('refused'), { code: 'ECONNREFUSED' })],
    ['a value that is not an object', 'boom'],
    ['an unlocated statement', pgError('23505')],
  ])('prints only the DEBUG_MIGRATIONS hint for %s', (_, error) => {
    const errors = logFailure('SELECT 1;\nSELECT 2;', error)
    expect(errors.slice(1)).toEqual([
      'Set DEBUG_MIGRATIONS=true to print the full SQL of migration m.sql.',
    ])
  })
})

describe('excerptFailingStatement', () => {
  const longStatement = ['SELECT', ...Array.from({ length: 99 }, (_, i) => `  ${i} AS c${i},`)]
  const longSql = `SELECT 0;\n${longStatement.join('\n')}\n  'end';`

  it('centers a long statement on the error position', () => {
    const position = longSql.indexOf('60 AS c60') + 1
    const excerpt = excerptFailingStatement(longSql, pgError('42703', position), 10)
    expect(excerpt?.split('\n')).toEqual([
      '  … 56 earlier lines of this statement',
      ...Array.from({ length: 10 }, (_, i) => {
        const line = 58 + i
        return `${line === 63 ? '>' : ' '} ${line} |   ${line - 3} AS c${line - 3},`
      }),
      '  … 35 more lines of this statement',
    ])
  })

  it('shows the start of a lone long statement without a position', () => {
    const sql = longStatement.join('\n')
    const excerpt = excerptFailingStatement(sql, pgError('42703'), 3)
    expect(excerpt).toBe(
      [
        '  1 | SELECT',
        '  2 |   0 AS c0,',
        '  3 |   1 AS c1,',
        '  … 97 more lines of this statement',
      ].join('\n'),
    )
  })

  it('counts an online statement position from that statement', () => {
    const sql = 'SELECT 1;\nSELECT ☃,\n  nope;'
    const error = pgError('42703', 12)
    rememberFailedStatement(error, 'SELECT ☃,\n  nope')
    expect(excerptFailingStatement(sql, error)).toBe('  2 | SELECT ☃,\n> 3 |   nope')
  })

  it('shows an online statement without a position', () => {
    const error = pgError('42P01')
    rememberFailedStatement(error, 'SELECT 2')
    expect(excerptFailingStatement('SELECT 1;\nSELECT 2;', error)).toBe('  2 | SELECT 2')
  })

  it('records no statement for values that are not objects', () => {
    rememberFailedStatement('boom', 'SELECT 1')
    expect(failedStatementOf('boom')).toBeUndefined()
    expect(failedStatementOf(null)).toBeUndefined()
  })

  it('returns undefined when the position is past every statement', () => {
    expect(excerptFailingStatement('SELECT 1;\nSELECT 2;   ', pgError('42601', 21))).toBeUndefined()
  })

  it('ignores positions that are not positive integers', () => {
    const error = Object.assign(new Error('x'), { code: '42601', position: 'abc' })
    expect(excerptFailingStatement('SELECT 1;\nSELECT 2;', error)).toBeUndefined()
  })
})

describe('describeMigrationError', () => {
  it('includes every PostgreSQL field that is present', () => {
    const error = Object.assign(new Error('could not load library'), {
      code: '58P01',
      detail: 'Symbol not found',
      hint: 'Restart the server',
      position: '',
      where: 'PL/pgSQL function f()',
    })
    expect(describeMigrationError(error)).toBe(
      [
        'could not load library',
        '  code: 58P01',
        '  detail: Symbol not found',
        '  hint: Restart the server',
        '  where: PL/pgSQL function f()',
      ].join('\n'),
    )
  })

  it('inspects values that are not errors', () => {
    expect(describeMigrationError('boom')).toBe("'boom'")
  })
})
