import { describe, expect, it, vi } from 'vitest'

import { executePreparedMigration, withMigrationRunnerSession } from './migration-session.mts'
import type { PsqlRuntime } from '../types.mts'

function createClient(options?: {
  failUnlock?: boolean
  failRestore?: boolean
  failBeforeLock?: boolean
}) {
  const queries: string[] = []
  const release = vi.fn()
  const client = {
    query: async (text: string) => {
      queries.push(text)
      if (options?.failBeforeLock && text.includes("set_config('lock_timeout'")) {
        throw new Error('set failed')
      }
      if (options?.failUnlock && text.includes('pg_advisory_unlock')) {
        throw new Error('unlock failed')
      }
      if (options?.failRestore && text.includes("set_config('lock_timeout'")) {
        if (queries.filter((query) => query.includes("set_config('lock_timeout'")).length > 1) {
          throw new Error('restore failed')
        }
      }
      if (text === 'FAIL') throw new Error('migration failed')
      if (text.includes('SHOW lock_timeout')) {
        return { rows: options?.failBeforeLock ? [] : [{ lock_timeout: '0' }] }
      }
      if (text.includes('SHOW statement_timeout')) return { rows: [] }
      return { rows: [], rowCount: 0 }
    },
    release,
  }
  return { client: client as never, queries, release }
}

function runtime(client: never): PsqlRuntime {
  return {
    pools: {
      write: { connect: async () => client } as never,
      read: { connect: vi.fn() } as never,
      advisoryLock: { connect: vi.fn() } as never,
    },
    env: {},
    errorHandler: () => {},
  }
}

describe('migration session', () => {
  it('runs a handler and restores session settings', async () => {
    const fixture = createClient()
    await expect(
      withMigrationRunnerSession(
        runtime(fixture.client),
        { lockTimeoutMs: 10, statementTimeoutMs: 20 },
        async () => 'ok',
      ),
    ).resolves.toBe('ok')
    expect(fixture.release).toHaveBeenCalledWith()
  })

  it('throws the handler error after cleanup', async () => {
    const fixture = createClient()
    await expect(
      withMigrationRunnerSession(
        runtime(fixture.client),
        { lockTimeoutMs: 10, statementTimeoutMs: 20 },
        async () => {
          throw new Error('handler failed')
        },
      ),
    ).rejects.toThrow('handler failed')
  })

  it('throws unlock cleanup errors', async () => {
    const fixture = createClient({ failUnlock: true })
    await expect(
      withMigrationRunnerSession(
        runtime(fixture.client),
        { lockTimeoutMs: 10, statementTimeoutMs: 20 },
        async () => 'ok',
      ),
    ).rejects.toThrow('unlock failed')
    expect(fixture.release).toHaveBeenCalledWith(expect.any(Error))
  })

  it('throws restore cleanup errors when unlock succeeds', async () => {
    const fixture = createClient({ failRestore: true })
    await expect(
      withMigrationRunnerSession(
        runtime(fixture.client),
        { lockTimeoutMs: 10, statementTimeoutMs: 20 },
        async () => 'ok',
      ),
    ).rejects.toThrow('restore failed')
  })

  it('restores settings when the advisory lock was never acquired', async () => {
    const fixture = createClient({ failBeforeLock: true })
    await expect(
      withMigrationRunnerSession(
        runtime(fixture.client),
        { lockTimeoutMs: 10, statementTimeoutMs: 20 },
        async () => 'ok',
      ),
    ).rejects.toThrow('set failed')
  })

  it('throws when session settings cannot be read', async () => {
    const client = {
      query: async () => {
        throw new Error('show failed')
      },
      release: vi.fn(),
    }
    await expect(
      withMigrationRunnerSession(
        runtime(client as never),
        { lockTimeoutMs: 10, statementTimeoutMs: 20 },
        async () => 'ok',
      ),
    ).rejects.toThrow('show failed')
  })

  it('executes online statements and transactional rollback', async () => {
    const fixture = createClient()
    await executePreparedMigration(
      fixture.client,
      '001.sql',
      { mode: 'online', statements: ['CREATE INDEX CONCURRENTLY IF NOT EXISTS idx ON t (id)'] },
      'abc',
    )
    await executePreparedMigration(
      fixture.client,
      '002.sql',
      { mode: 'online', statements: [] },
      'def',
    )
    await executePreparedMigration(
      fixture.client,
      '000.sql',
      { mode: 'transactional', statements: [] },
      'empty',
    )
    await expect(
      executePreparedMigration(
        fixture.client,
        '003.sql',
        { mode: 'transactional', statements: ['FAIL'] },
        'ghi',
      ),
    ).rejects.toThrow('migration failed')
  })

  it('preserves the migration failure when rollback also fails', async () => {
    const queries: string[] = []
    const client = {
      query: async (text: string) => {
        queries.push(text)
        if (text === 'BEGIN' || text === 'FAIL' || text === 'ROLLBACK') {
          if (text !== 'BEGIN')
            throw new Error(text === 'ROLLBACK' ? 'rollback failed' : 'migration failed')
        }
        return { rows: [], rowCount: 0 }
      },
    }
    await expect(
      executePreparedMigration(
        client as never,
        '003.sql',
        { mode: 'transactional', statements: ['FAIL'] },
        'ghi',
      ),
    ).rejects.toThrow('migration failed')
    expect(queries).toContain('ROLLBACK')
  })
})
