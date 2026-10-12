import { EventEmitter } from 'node:events'

import { describe, expect, it, vi } from 'vitest'

import { withNoticeEvents } from './pool-client-test-helpers.mts'
import { createTransactionApi } from './transactions.mts'
import type { PsqlRuntime } from './types.mts'

function runtime(
  client: { query: (input: { text?: string } | string) => Promise<unknown>; release: () => void },
  errorHandler = vi.fn(),
): PsqlRuntime {
  withNoticeEvents(client)
  return {
    pools: {
      write: { connect: async () => client } as never,
      read: { connect: vi.fn() } as never,
      advisoryLock: { connect: vi.fn() } as never,
    },
    env: { NODE_ENV: 'test' },
    errorHandler,
  }
}

describe('borrowed transaction cleanup', () => {
  it('rolls back a caller-owned transaction after commit fails without releasing it', async () => {
    const commitFailure = Object.assign(new Error('commit failed'), { code: '40001' })
    const queries: string[] = []
    const client = {
      query: async (input: { text?: string } | string) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        queries.push(text)
        if (text.includes('SAVEPOINT')) throw Object.assign(new Error('idle'), { code: '25P01' })
        if (text.includes('COMMIT')) throw commitFailure
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    await expect(
      createTransactionApi(runtime(client)).withTransactionOptions(
        { client: client as never },
        async () => 1,
      ),
    ).rejects.toBe(commitFailure)
    expect(queries).toEqual([
      'SAVEPOINT vouchington_transaction_probe',
      '/* withClientTransaction */ BEGIN',
      '/* withClientTransaction */ COMMIT',
      '/* withClientTransaction */ ROLLBACK',
    ])
    expect(client.release).not.toHaveBeenCalled()
  })

  it('reports rollback cleanup failure while preserving the commit error and caller ownership', async () => {
    const commitFailure = new Error('commit failed')
    const rollbackFailure = new Error('rollback failed')
    const reporter = vi.fn()
    const client = {
      query: async (input: { text?: string } | string) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        if (text.includes('SAVEPOINT')) throw Object.assign(new Error('idle'), { code: '25P01' })
        if (text.includes('COMMIT')) throw commitFailure
        if (text.includes('ROLLBACK')) throw rollbackFailure
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    await expect(
      createTransactionApi(runtime(client, reporter)).withTransactionOptions(
        { client: client as never },
        async () => 1,
      ),
    ).rejects.toBe(commitFailure)
    expect(reporter.mock.calls[0]?.[0]).toMatchObject({ errors: [commitFailure, rollbackFailure] })
    expect(client.release).not.toHaveBeenCalled()
  })

  it('does not retry rollback when a handler failure already exhausted it', async () => {
    const primary = new Error('handler failed')
    const rollbackFailure = new Error('rollback failed')
    const queries: string[] = []
    const client = {
      query: async (input: { text?: string } | string) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        queries.push(text)
        if (text.includes('SAVEPOINT')) throw Object.assign(new Error('idle'), { code: '25P01' })
        if (text.includes('ROLLBACK')) throw rollbackFailure
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    await expect(
      createTransactionApi(runtime(client)).withTransactionOptions(
        { client: client as never },
        async () => {
          throw primary
        },
      ),
    ).rejects.toBe(primary)
    expect(queries).toEqual([
      'SAVEPOINT vouchington_transaction_probe',
      '/* withClientTransaction */ BEGIN',
      '/* withClientTransaction */ ROLLBACK',
    ])
    expect(client.release).not.toHaveBeenCalled()
  })

  it('begins a borrowed client before returning, ahead of direct caller work', async () => {
    const queries: string[] = []
    const client = Object.assign(new EventEmitter(), {
      query: async (input: { text?: string } | string) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        queries.push(text)
        if (text.includes('SAVEPOINT')) throw Object.assign(new Error('idle'), { code: '25P01' })
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    })
    const api = createTransactionApi(runtime({ query: client.query, release: vi.fn() }))
    const transaction = await api.beginTransaction({ client: client as never })
    await client.query('/* direct */ SELECT 1')
    await transaction.commit()
    expect(queries).toEqual([
      'SAVEPOINT vouchington_transaction_probe',
      '/* beginTransaction */ BEGIN',
      '/* direct */ SELECT 1',
      '/* beginTransaction */ COMMIT',
    ])
  })

  it('rejects a nested borrowed BEGIN without rolling back or releasing the caller client', async () => {
    const queries: string[] = []
    const client = Object.assign(new EventEmitter(), {
      query: async (input: { text?: string } | string) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        queries.push(text)
        if (text.includes('SAVEPOINT')) throw Object.assign(new Error('idle'), { code: '25P01' })
        if (text.endsWith(' BEGIN')) client.emit('notice', { code: '25001' })
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    })
    const api = createTransactionApi(runtime({ query: client.query, release: vi.fn() }))
    await expect(api.beginTransaction({ client: client as never })).rejects.toThrow(
      'already has a transaction open',
    )
    expect(queries.some((query) => query.includes('ROLLBACK'))).toBe(false)
    expect(client.release).not.toHaveBeenCalled()
  })
})
