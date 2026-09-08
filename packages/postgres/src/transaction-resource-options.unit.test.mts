import type pg from 'pg'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { Psql } from './create-psql-types.mts'
import { createTransactionApi } from './transactions.mts'
import type { BeginTransactionOptions, PsqlRuntime } from './types.mts'

type Client = {
  query: (input: { text?: string } | string) => Promise<unknown>
  release: ReturnType<typeof vi.fn>
}

function runtime(client: Client, overrides: Partial<PsqlRuntime> = {}): PsqlRuntime {
  return {
    pools: {
      write: { connect: async () => client } as never,
      read: { connect: vi.fn() } as never,
      advisoryLock: { connect: vi.fn() } as never,
    },
    env: { NODE_ENV: 'test' },
    errorHandler: () => {},
    ...overrides,
  }
}

function idleClient(): { client: Client; queries: string[] } {
  const queries: string[] = []
  const client = {
    query: async (input: { text?: string } | string) => {
      const text = typeof input === 'string' ? input : (input.text ?? '')
      queries.push(text)
      if (text.includes('SAVEPOINT')) throw Object.assign(new Error('idle'), { code: '25P01' })
      return { rows: [], rowCount: 0 }
    },
    release: vi.fn(),
  }
  return { client, queries }
}

describe('beginTransaction resource options', () => {
  it('exposes only optional pool or pool-client resource selection', () => {
    expectTypeOf<BeginTransactionOptions>().toEqualTypeOf<{
      client?: pg.Pool | pg.PoolClient
    }>()
    expectTypeOf<Psql['beginTransaction']>()
      .parameter(0)
      .toEqualTypeOf<BeginTransactionOptions | undefined>()
  })

  it('acquires and releases a client from the selected pool after commit', async () => {
    const { client, queries } = idleClient()
    const selectedPool = { connect: vi.fn(async () => client) }

    const transaction = await createTransactionApi(runtime(client)).beginTransaction({
      client: selectedPool as never,
    })
    await transaction.commit()

    expect(selectedPool.connect).toHaveBeenCalledOnce()
    expect(queries).toContain('/* beginTransaction */ COMMIT')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('rolls back and releases a client acquired from the selected pool during async disposal', async () => {
    const { client, queries } = idleClient()
    const selectedPool = { connect: vi.fn(async () => client) }

    await (async () => {
      await using _transaction = await createTransactionApi(runtime(client)).beginTransaction({
        client: selectedPool as never,
      })
    })()

    expect(queries).toContain('/* beginTransaction */ ROLLBACK')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it('reports selected read-pool queries with the read timing label', async () => {
    const { client } = idleClient()
    const timings: string[] = []
    const selectedPool = { connect: vi.fn(async () => client) }
    const psqlRuntime = runtime(client, {
      onQueryTiming: (input) => timings.push(`${input.annotation}:${input.pool}`),
    })
    psqlRuntime.pools.read = selectedPool as never

    const transaction = await createTransactionApi(psqlRuntime).beginTransaction({
      client: selectedPool as never,
    })
    await transaction('/* selectedRead */ SELECT 1')
    await transaction.commit()

    expect(timings).toContain('selectedRead:read')
  })

  it('reports selected read-pool callback queries with the read timing label', async () => {
    const { client } = idleClient()
    const timings: string[] = []
    const selectedPool = { connect: vi.fn(async () => client) }
    const psqlRuntime = runtime(client, {
      onQueryTiming: (input) => timings.push(`${input.annotation}:${input.pool}`),
    })
    psqlRuntime.pools.read = selectedPool as never

    await createTransactionApi(psqlRuntime).withTransactionOptions(
      { client: selectedPool as never },
      async (transaction) => transaction('/* selectedCallbackRead */ SELECT 1'),
    )

    expect(timings).toContain('selectedCallbackRead:read')
  })

  it('reports active selected read-pool callback queries with the read timing label', async () => {
    const { client } = idleClient()
    client.query = async () => ({ rows: [], rowCount: 0 })
    const timings: string[] = []
    const selectedPool = { connect: vi.fn(async () => client) }
    const psqlRuntime = runtime(client, {
      onQueryTiming: (input) => timings.push(`${input.annotation}:${input.pool}`),
    })
    psqlRuntime.pools.read = selectedPool as never

    await createTransactionApi(psqlRuntime).withTransactionOptions(
      { client: selectedPool as never },
      async (transaction) => transaction('/* activeSelectedCallbackRead */ SELECT 1'),
    )

    expect(timings).toContain('activeSelectedCallbackRead:read')
    expect(client.release).toHaveBeenCalledOnce()
  })

  it.each(['commit', 'rollback'] as const)(
    'settles an inactive caller-managed client with %s without releasing it',
    async (operation) => {
      const { client, queries } = idleClient()
      const transaction = await createTransactionApi(runtime(client)).beginTransaction({
        client: client as never,
      })
      await transaction[operation]()

      expect(queries).toContain(`/* beginTransaction */ ${operation.toUpperCase()}`)
      expect(client.release).not.toHaveBeenCalled()
    },
  )

  it('rolls back an inactive caller-managed client during async disposal without releasing it', async () => {
    const { client, queries } = idleClient()

    await (async () => {
      await using _transaction = await createTransactionApi(runtime(client)).beginTransaction({
        client: client as never,
      })
    })()

    expect(queries).toContain('/* beginTransaction */ ROLLBACK')
    expect(client.release).not.toHaveBeenCalled()
  })

  it('preserves a caller-managed commit failure after compensating rollback', async () => {
    const commit = new Error('commit failed')
    const { client, queries } = idleClient()
    client.query = async (input) => {
      const text = typeof input === 'string' ? input : (input.text ?? '')
      queries.push(text)
      if (text.includes('SAVEPOINT')) throw Object.assign(new Error('idle'), { code: '25P01' })
      if (text.includes('COMMIT')) throw commit
      return { rows: [], rowCount: 0 }
    }

    await expect(
      (async () => {
        await using transaction = await createTransactionApi(runtime(client)).beginTransaction({
          client: client as never,
        })
        await transaction.commit()
      })(),
    ).rejects.toBe(commit)

    expect(queries).toContain('/* beginTransaction */ ROLLBACK')
    expect(client.release).not.toHaveBeenCalled()
  })

  it('reports failed caller-managed commit recovery without replacing the commit failure', async () => {
    const commit = new Error('commit failed')
    const rollback = 'rollback failed'
    const errors: Error[] = []
    const { client } = idleClient()
    client.query = async (input) => {
      const text = typeof input === 'string' ? input : (input.text ?? '')
      if (text.includes('SAVEPOINT')) throw Object.assign(new Error('idle'), { code: '25P01' })
      if (text.includes('COMMIT')) throw commit
      if (text.includes('ROLLBACK')) throw rollback
      return { rows: [], rowCount: 0 }
    }

    await expect(
      (async () => {
        await using transaction = await createTransactionApi(
          runtime(client, { errorHandler: (error) => errors.push(error) }),
        ).beginTransaction({ client: client as never })
        await transaction.commit()
      })(),
    ).rejects.toBe(commit)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({
      cause: commit,
      errors: [commit, new Error('Transaction failed: rollback failed')],
    })
    expect(client.release).not.toHaveBeenCalled()
  })

  it('does not run compensating cleanup after destroying an owned client on commit failure', async () => {
    const commit = new Error('commit failed')
    let released = false
    const { client } = idleClient()
    client.release = vi.fn(() => {
      released = true
    })
    client.query = async (input) => {
      const text = typeof input === 'string' ? input : (input.text ?? '')
      if (text.includes('SAVEPOINT')) throw Object.assign(new Error('idle'), { code: '25P01' })
      if (text.includes('COMMIT')) throw commit
      if (text.includes('ROLLBACK') && released) throw new Error('query after release')
      return { rows: [], rowCount: 0 }
    }

    await expect(
      (async () => {
        await using transaction = await createTransactionApi(runtime(client)).beginTransaction()
        await transaction.commit()
      })(),
    ).rejects.toBe(commit)

    expect(client.release).toHaveBeenCalledWith(true)
  })

  it('reports caller-managed automatic rollback failure without replacing a queued query failure', async () => {
    const queryFailure = new Error('queued query failed')
    const rollback = new Error('rollback failed')
    const errors: Error[] = []
    const { client } = idleClient()
    client.query = async (input) => {
      const text = typeof input === 'string' ? input : (input.text ?? '')
      if (text.includes('SAVEPOINT')) throw Object.assign(new Error('idle'), { code: '25P01' })
      if (text.includes('queuedFailure')) throw queryFailure
      if (text.includes('ROLLBACK')) throw rollback
      return { rows: [], rowCount: 0 }
    }

    await expect(
      (async () => {
        await using transaction = await createTransactionApi(
          runtime(client, { errorHandler: (error) => errors.push(error) }),
        ).beginTransaction({ client: client as never })
        void transaction('/* queuedFailure */ SELECT 1')
        await transaction.commit()
      })(),
    ).rejects.toBe(queryFailure)

    expect(errors).toHaveLength(1)
    expect(errors[0]).toMatchObject({ cause: queryFailure, errors: [queryFailure, rollback] })
    expect(client.release).not.toHaveBeenCalled()
  })

  it.each(['explicit rollback', 'async disposal'] as const)(
    'keeps a caller-managed client owned by the caller when %s rollback fails',
    async (mode) => {
      const rollback = new Error('rollback failed')
      const { client } = idleClient()
      client.query = async (input) => {
        const text = typeof input === 'string' ? input : (input.text ?? '')
        if (text.includes('SAVEPOINT')) throw Object.assign(new Error('idle'), { code: '25P01' })
        if (text.includes('ROLLBACK')) throw rollback
        return { rows: [], rowCount: 0 }
      }

      await expect(
        (async () => {
          await using transaction = await createTransactionApi(runtime(client)).beginTransaction({
            client: client as never,
          })
          if (mode === 'explicit rollback') await transaction.rollback()
        })(),
      ).rejects.toBe(rollback)

      expect(client.release).not.toHaveBeenCalled()
    },
  )

  it('rejects an active caller-managed client without releasing or settling it', async () => {
    const queries: string[] = []
    const client = {
      query: async (input: { text?: string } | string) => {
        queries.push(typeof input === 'string' ? input : (input.text ?? ''))
        return { rows: [], rowCount: 0 }
      },
      release: vi.fn(),
    }

    await expect(
      createTransactionApi(runtime(client)).beginTransaction({ client: client as never }),
    ).rejects.toThrow(
      'Cannot create an owned transaction from an active caller-managed pool client',
    )
    expect(queries).toEqual([
      'SAVEPOINT vouchington_transaction_probe',
      'RELEASE SAVEPOINT vouchington_transaction_probe',
    ])
    expect(client.release).not.toHaveBeenCalled()
  })
})
