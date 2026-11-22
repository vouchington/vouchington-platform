import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { beforeAll, describe, expect, it, vi } from 'vitest'

import { runConfigDriven } from './config-driven.mts'
import {
  runConfigDrivenStatementsInTransaction,
  type ConfigDrivenTarget,
} from './config-driven-statements.mts'
import { loadSqlParserModule } from './sql-statements.mts'
import type { QueryExecutor } from '../types.mts'

beforeAll(loadSqlParserModule)

const plain = (statement: string) => statement.replace(/^\/\* \w+ \*\/ /u, '')

function fakeWriter(fail?: (sql: string) => Error | undefined) {
  const log: string[] = []
  const writer = vi.fn(async (input: unknown) => {
    const sql = plain(String(input))
    log.push(sql)
    const error = fail?.(sql)
    if (error) throw error
    return { rows: [] }
  }) as unknown as QueryExecutor
  return { writer, log }
}

function fakeTransactions() {
  const log: string[] = []
  const beginTransaction = vi.fn(async () => {
    const transaction = Object.assign(
      async (input: unknown) => {
        log.push(plain(String(input)))
        return { rows: [] }
      },
      {
        commit: async () => void log.push('COMMIT'),
        [Symbol.asyncDispose]: async () => void log.push('DISPOSE'),
      },
    )
    return transaction as unknown as QueryExecutor & typeof transaction
  })
  return { beginTransaction, log }
}

describe('runConfigDrivenStatementsInTransaction', () => {
  const sql = `INSERT INTO a VALUES (1);
    ALTER TABLE a VALIDATE CONSTRAINT c;
    INSERT INTO a VALUES (2);`

  it('runs groups on a caller-held session, isolating constraint validation', async () => {
    const { writer, log } = fakeWriter()
    await runConfigDrivenStatementsInTransaction(sql, { writer }, { lockTimeoutMs: 1234.4 })
    const lock = "SET LOCAL lock_timeout = '1234ms'"
    expect(log).toEqual([
      'BEGIN',
      lock,
      'INSERT INTO a VALUES (1)',
      'COMMIT',
      'BEGIN',
      lock,
      'ALTER TABLE a VALIDATE CONSTRAINT c',
      'COMMIT',
      'BEGIN',
      lock,
      'INSERT INTO a VALUES (2)',
      'COMMIT',
    ])
  })

  it('opens one owned transaction per group when given beginTransaction', async () => {
    const { beginTransaction, log } = fakeTransactions()
    await runConfigDrivenStatementsInTransaction(sql, { beginTransaction })
    expect(beginTransaction).toHaveBeenCalledTimes(3)
    expect(log.filter((entry) => entry === 'COMMIT')).toHaveLength(3)
    expect(log).toContain("SET LOCAL lock_timeout = '5000ms'")
  })

  it('runs nothing for empty SQL', async () => {
    const { writer, log } = fakeWriter()
    await runConfigDrivenStatementsInTransaction('', { writer })
    expect(log).toEqual([])
  })

  it('rolls back, reports a failed rollback, and rethrows the original error', async () => {
    const reportError = vi.fn()
    const failure = new Error('statement failed')
    const { writer, log } = fakeWriter((statement) => {
      if (statement.startsWith('INSERT')) return failure
      if (statement === 'ROLLBACK') return new Error('rollback failed')
      return undefined
    })
    await expect(
      runConfigDrivenStatementsInTransaction(
        'INSERT INTO a VALUES (1)',
        { writer },
        { reportError },
      ),
    ).rejects.toBe(failure)
    expect(log.at(-1)).toBe('ROLLBACK')
    expect(reportError).toHaveBeenCalledOnce()
  })

  it('tolerates a failed rollback with no reporter and non-Error rejections', async () => {
    const writer = vi.fn(async (input: unknown) => {
      const sql = plain(String(input))
      if (sql.startsWith('INSERT')) throw new Error('boom')
      if (sql === 'ROLLBACK') throw 'plain'
      return { rows: [] }
    }) as unknown as QueryExecutor
    await expect(
      runConfigDrivenStatementsInTransaction('INSERT INTO a VALUES (1)', { writer }),
    ).rejects.toThrow('boom')
    const reportError = vi.fn()
    await expect(
      runConfigDrivenStatementsInTransaction(
        'INSERT INTO a VALUES (1)',
        { writer },
        { reportError },
      ),
    ).rejects.toThrow('boom')
    expect(reportError).toHaveBeenCalledWith(new Error('plain'))
  })
})

describe('runConfigDriven', () => {
  function folderWith(files: Record<string, string>): string {
    const folder = fs.mkdtempSync(path.join(os.tmpdir(), 'config-driven-'))
    for (const [name, body] of Object.entries(files))
      fs.writeFileSync(path.join(folder, name), body)
    return folder
  }

  it('runs files in filename order and logs completion', async () => {
    const folder = folderWith({ '02-b.sql': 'SELECT 2;', '01-a.sql': 'SELECT 1;' })
    const { writer, log } = fakeWriter()
    const logger = { log: vi.fn(), error: vi.fn() }
    await runConfigDriven(folder, { target: { writer }, logger })
    expect(log.filter((entry) => entry.startsWith('SELECT'))).toEqual(['SELECT 1', 'SELECT 2'])
    expect(logger.log).toHaveBeenCalledWith('Config-driven migration %s complete!', '01-a.sql')
  })

  it('does nothing for a missing folder and works with a silent default logger', async () => {
    const { writer, log } = fakeWriter()
    await runConfigDriven(path.join(os.tmpdir(), 'missing-config-driven'), { target: { writer } })
    expect(log).toEqual([])
    await runConfigDriven(folderWith({ '1.sql': 'SELECT 1;' }), { target: { writer } })
    expect(log).toContain('SELECT 1')
  })

  it('uses an injected file reader', async () => {
    const folder = folderWith({ 'seed.mts': 'ignored' })
    const { writer, log } = fakeWriter()
    const readFile = vi.fn(async () => 'SELECT 42;')
    await runConfigDriven(folder, { target: { writer }, readFile })
    expect(readFile).toHaveBeenCalledWith(folder, 'seed.mts')
    expect(log).toContain('SELECT 42')
  })

  it.each(['40P01', '55P03'])('retries %s, then succeeds', async (code) => {
    const folder = folderWith({ '1.sql': 'SELECT 1;' })
    let failures = 1
    const { writer } = fakeWriter((statement) =>
      statement === 'SELECT 1' && failures-- > 0
        ? Object.assign(new Error('busy'), { code })
        : undefined,
    )
    const waitForRetry = vi.fn(async () => undefined)
    const logger = { log: vi.fn(), error: vi.fn() }
    await runConfigDriven(folder, { target: { writer }, logger, waitForRetry })
    expect(waitForRetry).toHaveBeenCalledExactlyOnceWith(1)
    expect(logger.log).toHaveBeenCalledWith(
      expect.stringContaining('retrying attempt'),
      '1.sql',
      code,
      2,
      3,
    )
  })

  it('dumps the SQL and rethrows when attempts run out or the error is not retryable', async () => {
    const folder = folderWith({ '1.sql': 'SELECT 1;' })
    const waitForRetry = vi.fn(async () => undefined)
    const busy = Object.assign(new Error('busy'), { code: '40P01' })
    const { writer } = fakeWriter((statement) => (statement === 'SELECT 1' ? busy : undefined))
    const logger = { log: vi.fn(), error: vi.fn() }
    await expect(
      runConfigDriven(folder, { target: { writer }, logger, waitForRetry, maxAttempts: 2 }),
    ).rejects.toBe(busy)
    expect(waitForRetry).toHaveBeenCalledOnce()
    expect(logger.error).toHaveBeenCalledWith('SELECT 1;')

    const other = fakeWriter((statement) =>
      statement === 'SELECT 1' ? new Error('syntax') : undefined,
    )
    const target: ConfigDrivenTarget = { writer: other.writer }
    await expect(runConfigDriven(folder, { target, logger, waitForRetry })).rejects.toThrow(
      'syntax',
    )
    const coded = fakeWriter((s) =>
      s === 'SELECT 1' ? Object.assign(new Error('other'), { code: '23505' }) : undefined,
    )
    await expect(
      runConfigDriven(folder, { target: { writer: coded.writer }, logger }),
    ).rejects.toThrow('other')
  })

  it('backs off with the default wait', async () => {
    vi.useFakeTimers()
    const folder = folderWith({ '1.sql': 'SELECT 1;' })
    let failures = 1
    const { writer } = fakeWriter((statement) =>
      statement === 'SELECT 1' && failures-- > 0
        ? Object.assign(new Error('busy'), { code: '55P03' })
        : undefined,
    )
    const run = runConfigDriven(folder, { target: { writer } })
    await vi.advanceTimersByTimeAsync(5000)
    await run
    vi.useRealTimers()
  })
})
