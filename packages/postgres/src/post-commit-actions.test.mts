import { describe, expect, it, vi } from 'vitest'

import { createPostCommitActions } from './post-commit-actions.mts'
import { withPsql } from './test-helpers.mts'
import type { QueryExecutor, TransactionQuery } from './types.mts'

async function setup<Result>(
  run: (context: {
    actions: ReturnType<typeof createPostCommitActions>
    reported: Error[]
    begin: () => Promise<Awaited<ReturnType<ReturnType<typeof createPostCommitActions>['own']>>>
    nested: <R>(
      options: Parameters<ReturnType<typeof createPostCommitActions>['withTransactionOptions']>[1],
      handler: (query: TransactionQuery) => Promise<R>,
      wrap?: (query: TransactionQuery) => TransactionQuery,
    ) => Promise<R>
  }) => Promise<Result>,
): Promise<Result> {
  return withPsql(async (psql) => {
    const reported: Error[] = []
    const actions = createPostCommitActions({ reportError: (error) => reported.push(error) })
    return run({
      actions,
      reported,
      begin: async () => actions.own(await psql.beginTransaction()),
      nested: (options, handler, wrap) =>
        actions.withTransactionOptions(psql.withTransactionOptions, options, handler, wrap),
    })
  })
}

const noop = async () => undefined

describe('createPostCommitActions', () => {
  it('runs actions only after an explicit commit', async () => {
    await setup(async ({ actions, begin }) => {
      const action = vi.fn(noop)
      await using transaction = await begin()
      actions.register(transaction, action)
      expect(action).not.toHaveBeenCalled()
      await transaction.commit()
      expect(action).toHaveBeenCalledOnce()
    })
  })

  it('drops actions on dispose and rollback, then rejects new registrations', async () => {
    await setup(async ({ actions, begin }) => {
      const action = vi.fn(noop)
      {
        await using transaction = await begin()
        actions.register(transaction, action)
      }
      await using rolledBack = await begin()
      actions.register(rolledBack, action)
      await rolledBack.rollback()
      expect(action).not.toHaveBeenCalled()
      expect(() => actions.register(rolledBack, action)).toThrow(
        'Post-commit actions require an owned transaction query',
      )
    })
  })

  it('uses a custom unowned message', () => {
    const actions = createPostCommitActions({ reportError: vi.fn(), unownedMessage: 'not owned' })
    expect(() => actions.register((() => undefined) as unknown as QueryExecutor, noop)).toThrow(
      'not owned',
    )
  })

  it('reports sync and async failures without skipping siblings', async () => {
    await setup(async ({ actions, begin, reported }) => {
      const sibling = vi.fn(noop)
      const rejection = new Error('async failure')
      await using transaction = await begin()
      actions.register(transaction, () => {
        throw new Error('sync failure')
      })
      actions.register(transaction, async () => Promise.reject(rejection))
      actions.register(transaction, () => Promise.reject('plain string'))
      actions.register(transaction, sibling)
      await transaction.commit()
      expect(sibling).toHaveBeenCalledOnce()
      expect(reported.map((error) => error.message)).toEqual([
        'sync failure',
        'async failure',
        'plain string',
      ])
    })
  })

  it('defers nested client scopes to the owner and discards rejected scopes', async () => {
    await setup(async ({ actions, begin, nested }) => {
      const before = vi.fn(noop)
      const rejected = vi.fn(noop)
      const kept = vi.fn(noop)
      const inner = vi.fn(noop)
      await using transaction = await begin()
      actions.register(transaction, before)
      await expect(
        nested({ client: transaction.client }, async (query) => {
          actions.register(query, rejected)
          await nested({ client: query.client }, async (deeper) => actions.register(deeper, inner))
          throw new Error('nested rollback')
        }),
      ).rejects.toThrow('nested rollback')
      await nested({ client: transaction.client }, async (query) => actions.register(query, kept))
      expect(kept).not.toHaveBeenCalled()
      await transaction.commit()
      expect(before).toHaveBeenCalledOnce()
      expect(kept).toHaveBeenCalledOnce()
      expect(rejected).not.toHaveBeenCalled()
      expect(inner).not.toHaveBeenCalled()
    })
  })

  it('resolves ownership through a query wrapper and wraps unowned queries', async () => {
    await setup(async ({ actions, begin, nested }) => {
      const action = vi.fn(noop)
      const wrapped = vi.fn((query: TransactionQuery) => query)
      await using transaction = await begin()
      const wrapper = Object.assign(
        ((input, values) => transaction(input, values)) as QueryExecutor,
        {
          client: transaction.client,
        },
      )
      await nested({ query: wrapper }, async (query) => actions.register(query, action), wrapped)
      expect(wrapped).toHaveBeenCalledOnce()
      await transaction.commit()
      expect(action).toHaveBeenCalledOnce()
    })
  })

  it('treats an unowned scope as plain pass-through', async () => {
    await setup(async ({ actions, nested }) => {
      await nested({}, async (query) => {
        expect(() => actions.register(query, noop)).toThrow('owned transaction')
      })
      await nested({ query: (() => undefined) as unknown as QueryExecutor }, async () => undefined)
    })
  })

  it('commits with nothing registered and keeps an owned query unwrapped', async () => {
    await setup(async ({ actions, begin, nested }) => {
      const action = vi.fn(noop)
      const wrapped = vi.fn((query: TransactionQuery) => query)
      await using empty = await begin()
      await empty.commit()
      await using transaction = await begin()
      await nested(
        { query: transaction },
        async (query) => actions.register(query, action),
        wrapped,
      )
      await transaction.commit()
      expect(action).toHaveBeenCalledOnce()
    })
  })

  it('does not let an independent nested transaction register on the outer owner', async () => {
    await setup(async ({ actions, begin, nested }) => {
      const action = vi.fn(noop)
      await using transaction = await begin()
      await nested({ client: transaction.client }, async () => {
        await nested({}, async (independent) => {
          expect(() => actions.register(independent, action)).toThrow('owned transaction')
        })
      })
    })
  })

  it('wraps an application-decorated transaction and keeps it as the owner', async () => {
    await withPsql(async (psql) => {
      const actions = createPostCommitActions({ reportError: vi.fn() })
      const action = vi.fn(noop)
      const raw = await psql.beginTransaction()
      const decorated = Object.assign(((input, values) => raw(input, values)) as TransactionQuery, {
        client: raw.client,
        commit: raw.commit,
        rollback: raw.rollback,
        [Symbol.asyncDispose]: raw[Symbol.asyncDispose],
      })
      const owned = actions.own(raw, decorated)
      expect(owned).toBe(decorated)
      actions.register(owned, action)
      await owned.commit()
      expect(action).toHaveBeenCalledOnce()
    })
  })
})
