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
  it('opens with a bounded BEGIN and never probes the pooled connection', async () => {
    const statements: QueryConfig[] = []
    const client = {
      query: async (input: QueryConfig) => {
        statements.push(input)
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    await createBoundedTransactionApi(runtime(client)).beginBoundedTransaction({
      connectionTimeoutMs: 100,
      statementTimeoutMs: 50,
    })
    expect(statements[0]).toEqual(
      expect.objectContaining({
        query_timeout: 50,
        text: '/* beginBoundedTransaction */ BEGIN',
      }),
    )
    expect(statements.some((statement) => statement.text?.includes('SAVEPOINT'))).toBe(false)
  })

  it('rejects a bounded BEGIN timeout and destroys the pool client before callback work', async () => {
    const timeout = Object.assign(new Error('begin timed out'), { code: '57014' })
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
    expect(query).toHaveBeenCalledWith(
      expect.objectContaining({
        query_timeout: 50,
        text: '/* withBoundedTransaction */ BEGIN',
      }),
    )
    expect(client.release).toHaveBeenCalledWith(true)
  })
})
