import type pg from 'pg'
import { describe, expect, expectTypeOf, it, vi } from 'vitest'

import type { Psql } from './create-psql-types.mts'
import { createTransactionApi } from './transactions.mts'
import type { BeginTransactionOptions, PsqlRuntime } from './types.mts'

type Client = {
  query: (input: { text?: string } | string) => Promise<unknown>
  release: ReturnType<typeof vi.fn>
}

function runtime(client: Client): PsqlRuntime {
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
