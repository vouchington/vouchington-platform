import { describe, expect, it, vi } from 'vitest'

import { createBoundedTransactionApi } from './bounded-transaction-api.mts'
import { createTransactionApi } from './transactions.mts'
import type { PsqlRuntime } from './types.mts'

function runtime(client: {
  query: (input: { text?: string } | string) => Promise<unknown>
  release: () => void
}): PsqlRuntime {
  return {
    pools: {
      write: { connect: async () => client } as never,
      read: { connect: vi.fn() } as never,
      advisoryLock: { connect: vi.fn() } as never,
    },
    env: { NODE_ENV: 'test' },
    errorHandler: () => {},
  }
}

type StartOwnedTransaction = (runtimeForClient: PsqlRuntime, pool: unknown) => Promise<unknown>

/**
 * Every owned entry point acquires its own connection from a pool, so the
 * connection is idle by construction and its transaction state needs no
 * discovery. Probing it with `SAVEPOINT` reaches an idle backend, which
 * PostgreSQL answers with `25P01` and logs server-side as an `ERROR` for every
 * transaction the process opens -- invisible to the application, which swallows
 * the probe failure by design.
 */
describe('owned transactions never probe a pooled connection', () => {
  const starters: [string, StartOwnedTransaction][] = [
    [
      'beginTransaction',
      async (psqlRuntime) => createTransactionApi(psqlRuntime).beginTransaction(),
    ],
    [
      'withTransaction',
      async (psqlRuntime) =>
        createTransactionApi(psqlRuntime).withTransaction(async () => undefined),
    ],
    [
      'withTransactionOptions with a pool',
      async (psqlRuntime, pool) =>
        createTransactionApi(psqlRuntime).withTransactionOptions(
          { client: pool as never },
          async () => undefined,
        ),
    ],
    [
      'beginBoundedTransaction',
      async (psqlRuntime) =>
        createBoundedTransactionApi(psqlRuntime).beginBoundedTransaction({
          connectionTimeoutMs: 100,
          statementTimeoutMs: 50,
        }),
    ],
  ]

  it.each(starters)('opens %s with BEGIN and no SAVEPOINT', async (_name, start) => {
    const queries: string[] = []
    const client = {
      query: async (input: { text?: string } | string) => {
        queries.push(typeof input === 'string' ? input : (input.text ?? ''))
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    const pool = { connect: async () => client }

    await start(runtime(client), pool)

    expect(queries[0]).toMatch(/ BEGIN$/)
    expect(queries.some((query) => query.includes('SAVEPOINT'))).toBe(false)
  })
})
