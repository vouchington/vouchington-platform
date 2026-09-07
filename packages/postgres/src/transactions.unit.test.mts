import { describe, expect, it, vi } from 'vitest'

import { executeClientQuery } from './execute-client-query.mts'
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
  it('commits an explicitly settled transaction and rejects later queries', async () => {
    const queries: string[] = []
    const client = {
      query: async (input: { text?: string } | string) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        queries.push(text)
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    const transaction = await createTransactionApi(runtime(client)).beginTransaction()
    await transaction('/* resource */ SELECT 1')
    await transaction.commit()
    await expect(transaction('/* after */ SELECT 1')).rejects.toThrow('already settled')
    expect(queries).toContain('/* beginTransaction */ COMMIT')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rolls back and releases an uncommitted async-disposed transaction', async () => {
    const queries: string[] = []
    const client = {
      query: async (input: { text?: string } | string) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        queries.push(text)
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    const transaction = await createTransactionApi(runtime(client)).beginTransaction()
    await transaction[Symbol.asyncDispose]()
    await transaction[Symbol.asyncDispose]()
    expect(queries).toContain('/* beginTransaction */ ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('destroys clients after initial or terminal control failures', async () => {
    const beginFailure = new Error('begin failed')
    const beginClient = { query: async () => Promise.reject(beginFailure), release: vi.fn() }
    await expect(createTransactionApi(runtime(beginClient)).beginTransaction()).rejects.toBe(
      beginFailure,
    )
    expect(beginClient.release).toHaveBeenCalledWith(true)

    const commitFailure = new Error('commit failed')
    const commitClient = {
      query: async (input: { text?: string } | string) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        if (text.includes('COMMIT')) throw commitFailure
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    const transaction = await createTransactionApi(runtime(commitClient)).beginTransaction()
    await expect(transaction.commit()).rejects.toBe(commitFailure)
    expect(commitClient.release).toHaveBeenCalledWith(true)
  })

  it('shares concurrent settlement and rejects an opposite operation', async () => {
    const queries: string[] = []
    const client = {
      query: async (input: { text?: string } | string) => {
        queries.push(typeof input === 'string' ? input : (input.text ?? ''))
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    const transaction = await createTransactionApi(runtime(client)).beginTransaction()
    await Promise.all([transaction.commit(), transaction.commit()])
    await expect(transaction.rollback()).rejects.toThrow('already settled')
    expect(queries.filter((query) => query.includes('COMMIT'))).toHaveLength(1)
  })

  it('tracks falsy query failures without treating the transaction as healthy', async () => {
    const client = {
      query: async (input: { text?: string } | string) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        if (text.includes('falsy')) throw undefined
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    const transaction = await createTransactionApi(runtime(client)).beginTransaction()
    await expect(transaction('/* falsy */ SELECT 1')).rejects.toBeUndefined()
    await expect(transaction('/* later */ SELECT 1')).rejects.toThrow(
      'Transaction failed: undefined',
    )
    await expect(transaction.commit()).rejects.toThrow('Transaction failed: undefined')
  })

  it('keeps native await-using cleanup failure as a SuppressedError', async () => {
    const body = new Error('body failed')
    const rollback = new Error('rollback failed')
    const client = {
      query: async (input: { text?: string } | string) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        if (text.includes('ROLLBACK')) throw rollback
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    await expect(
      (async () => {
        await using _transaction = await createTransactionApi(runtime(client)).beginTransaction()
        throw body
      })(),
    ).rejects.toMatchObject({ error: rollback, suppressed: body })
    expect(client.release).toHaveBeenCalledWith(true)
  })

  it('destroys the client when rollback after a queued failure also fails', async () => {
    const client = {
      query: async (input: { text?: string } | string) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        if (text.includes('queued')) throw new Error('queued failed')
        if (text.includes('ROLLBACK')) throw new Error('rollback failed')
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }
    const transaction = await createTransactionApi(runtime(client)).beginTransaction()
    await expect(transaction('/* queued */ SELECT 1')).rejects.toThrow('queued failed')
    await expect(transaction.commit()).rejects.toThrow('queued failed')
    expect(client.release).toHaveBeenCalledWith(true)
  })

  it('keeps borrowed-client probe failures observable', async () => {
    const client = {
      query: async () => {
        throw Object.assign(new Error('disk full'), { code: '53100' })
      },
      release: vi.fn(),
    }
    await expect(
      createTransactionApi(runtime(client)).withTransactionOptions(
        { client: client as never },
        async () => 1,
      ),
    ).rejects.toThrow('disk full')
  })

  it('leaves a borrowed client with its caller when BEGIN fails', async () => {
    const client = {
      query: async (input: { text?: string } | string) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        if (text.includes('SAVEPOINT')) throw Object.assign(new Error('idle'), { code: '25P01' })
        throw new Error('begin failed')
      },
      release: vi.fn(),
    }
    await expect(
      createTransactionApi(runtime(client)).withTransactionOptions(
        { client: client as never },
        async () => 1,
      ),
    ).rejects.toThrow('begin failed')
    expect(client.release).not.toHaveBeenCalled()
  })

  it('propagates timeouts through SQL-statement query configs', async () => {
    const query = vi.fn(async () => ({ rows: [], rowCount: 0 }))
    await executeClientQuery(
      { query } as never,
      { text: '/* statement */ SELECT 1', values: [] } as never,
      undefined,
      'client',
      { queryTimeoutMs: 12 },
    )
    expect(query).toHaveBeenCalledWith(expect.objectContaining({ query_timeout: 12 }))
  })
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
