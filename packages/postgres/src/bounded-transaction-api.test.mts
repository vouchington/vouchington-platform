import { describe, expect, it, vi } from 'vitest'

import { createBoundedTransactionApi } from './bounded-transaction-api.mts'
import { withPsql } from './test-helpers.mts'
import type { PsqlRuntime } from './types.mts'

describe('withBoundedTransaction', () => {
  it('commits a bounded transaction', async () => {
    await withPsql(async (psql) => {
      await expect(
        psql.withBoundedTransaction(
          { connectionTimeoutMs: 2_000, statementTimeoutMs: 2_000 },
          async (query) => {
            const result = await query('/* bounded */ SELECT 4 AS n')
            return result.rows[0]
          },
        ),
      ).resolves.toEqual({ n: 4 })
    })
  })

  it('times out connection acquisition and ignores a late connect rejection', async () => {
    let rejectConnect: ((error: Error) => void) | undefined
    const runtime: PsqlRuntime = {
      pools: {
        write: {
          connect: () =>
            new Promise((_resolve, reject) => {
              rejectConnect = reject
            }),
        } as never,
        read: { connect: vi.fn() } as never,
        advisoryLock: { connect: vi.fn() } as never,
      },
      env: {},
      errorHandler: () => {},
    }
    const pending = createBoundedTransactionApi(runtime)(
      { connectionTimeoutMs: 20, statementTimeoutMs: 20 },
      async () => 1,
    )
    await expect(pending).rejects.toThrow('timed out after 20ms')
    rejectConnect?.(new Error('connect failed'))
    await Promise.resolve()
  })

  it('releases a client that connects after the timeout', async () => {
    const release = vi.fn()
    let resolveConnect: ((client: { release: typeof release }) => void) | undefined
    const runtime: PsqlRuntime = {
      pools: {
        write: {
          connect: () =>
            new Promise((resolve) => {
              resolveConnect = resolve
            }),
        } as never,
        read: { connect: vi.fn() } as never,
        advisoryLock: { connect: vi.fn() } as never,
      },
      env: {},
      errorHandler: () => {},
    }
    const pending = createBoundedTransactionApi(runtime)(
      { connectionTimeoutMs: 20, statementTimeoutMs: 20 },
      async () => 1,
    )
    await expect(pending).rejects.toThrow('timed out after 20ms')
    resolveConnect?.({ release })
    await vi.waitFor(() => expect(release).toHaveBeenCalled())
  })
})
