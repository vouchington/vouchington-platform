import { describe, expect, it, vi } from 'vitest'

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

describe('transaction probes and rollback', () => {
  it('rethrows unexpected savepoint probe errors', async () => {
    const client = {
      query: async () => {
        throw Object.assign(new Error('disk full'), { code: '53100' })
      },
      release: vi.fn(),
    }
    await expect(
      createTransactionApi(runtime(client)).withTransaction(async () => 1),
    ).rejects.toThrow('disk full')
    expect(client.release).toHaveBeenCalled()
  })

  it('ignores rollback failures when the handler rejects', async () => {
    const queries: string[] = []
    const client = {
      query: async (input: { text?: string } | string) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        queries.push(text)
        if (text.includes('SAVEPOINT')) {
          throw Object.assign(new Error('idle'), { code: '25P01' })
        }
        if (text.includes('ROLLBACK')) throw new Error('rollback failed')
        if (text.includes('boom')) return Promise.reject('nope')
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    await expect(
      createTransactionApi(runtime(client)).withTransaction(async (query) => {
        await query('/* boom */ SELECT 1')
        return 1
      }),
    ).rejects.toBe('nope')
    expect(queries.some((query) => query.includes('ROLLBACK'))).toBe(true)
  })

  it('rethrows a later queued Error after a prior failure', async () => {
    const queued = new Error('queued')
    const client = {
      query: async (input: { text?: string } | string) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        if (text.includes('SAVEPOINT')) {
          throw Object.assign(new Error('idle'), { code: '25P01' })
        }
        if (text.includes('queued')) throw queued
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    await expect(
      createTransactionApi(runtime(client)).withTransaction(async (query) => {
        void query('/* queued */ SELECT 1')
        await expect(query('/* later */ SELECT 1')).rejects.toBe(queued)
        return 1
      }),
    ).rejects.toBe(queued)
  })

  it('wraps a non-Error failure after the handler returns', async () => {
    const client = {
      query: async (input: { text?: string } | string) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        if (text.includes('SAVEPOINT')) {
          throw Object.assign(new Error('idle'), { code: '25P01' })
        }
        if (text.includes('boom')) return Promise.reject('nope')
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    await expect(
      createTransactionApi(runtime(client)).withTransaction(async (query) => {
        void query('/* boom */ SELECT 1')
        return 1
      }),
    ).rejects.toThrow('Transaction failed: nope')
  })
})
