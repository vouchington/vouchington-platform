import { describe, expect, it, vi } from 'vitest'

import { createBoundedTransactionApi } from './bounded-transaction-api.mts'
import type { PsqlRuntime } from './types.mts'

type QueryConfig = { query_timeout?: number; text?: string }

function runtime(client: {
  query: (input: QueryConfig) => Promise<unknown>
  release: () => void
}): PsqlRuntime {
  return {
    pools: {
      write: { connect: async () => client } as never,
      read: { connect: vi.fn() } as never,
      advisoryLock: { connect: vi.fn() } as never,
    },
    env: { NODE_ENV: 'test' },
    errorHandler: vi.fn(),
  }
}

describe('bounded transaction preflight', () => {
  it('bounds both active-transaction probe controls before destroying the client', async () => {
    const probes: QueryConfig[] = []
    const client = {
      query: async (input: QueryConfig) => {
        probes.push(input)
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    await expect(
      createBoundedTransactionApi(runtime(client)).beginBoundedTransaction({
        connectionTimeoutMs: 100,
        statementTimeoutMs: 50,
      }),
    ).rejects.toThrow('Cannot create an owned transaction from an active pool client')
    expect(probes).toEqual([
      { query_timeout: 50, text: 'SAVEPOINT vouchington_transaction_probe' },
      { query_timeout: 50, text: 'RELEASE SAVEPOINT vouchington_transaction_probe' },
    ])
    expect(client.release).toHaveBeenCalledWith(true)
  })

  it('rejects a bounded probe timeout and destroys the pool client before callback work', async () => {
    const timeout = Object.assign(new Error('probe timed out'), { code: '57014' })
    const query = vi.fn(async (_input: QueryConfig) => {
      throw timeout
    })
    const client = { query, release: vi.fn() }
    await expect(
      createBoundedTransactionApi(runtime(client)).withBoundedTransaction(
        { connectionTimeoutMs: 100, statementTimeoutMs: 50 },
        async () => 1,
      ),
    ).rejects.toBe(timeout)
    expect(query).toHaveBeenCalledWith({
      query_timeout: 50,
      text: 'SAVEPOINT vouchington_transaction_probe',
    })
    expect(client.release).toHaveBeenCalledWith(true)
  })
})
