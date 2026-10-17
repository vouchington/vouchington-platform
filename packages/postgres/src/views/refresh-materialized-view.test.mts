import { describe, expect, it, vi } from 'vitest'

import { useIsolatedDatabase } from '../test-helpers.mts'
import { refreshMaterializedView } from './refresh-materialized-view.mts'

const withPsql = useIsolatedDatabase()

type Reply = { rows: { locked?: boolean; unlocked?: boolean }[] } | Error

function fakePool(replies: Reply[]) {
  const client = {
    query: vi.fn(async () => {
      const reply = replies.shift()
      if (reply instanceof Error) throw reply
      return reply ?? { rows: [] }
    }),
    release: vi.fn(),
  }
  return { client, pool: { connect: vi.fn(async () => client) } as never }
}

const locked: Reply = { rows: [{ locked: true }] }
const unlocked: Reply = { rows: [{ unlocked: true }] }

describe('refreshMaterializedView', () => {
  it('refreshes concurrently under the advisory lock', async () => {
    await withPsql(async (psql) => {
      await psql.write('/* setup */ CREATE MATERIALIZED VIEW mv_numbers AS SELECT 1 AS id')
      await psql.write('/* setup */ CREATE UNIQUE INDEX mv_numbers_id ON mv_numbers (id)')
      await refreshMaterializedView({
        pool: psql.writePool,
        viewName: 'mv_numbers',
        allowedViews: ['mv_numbers'],
      })
      await refreshMaterializedView({
        pool: psql.writePool,
        viewName: 'mv_numbers',
        allowedViews: new Set(['mv_numbers']),
        advisoryLockKey: 'custom',
      })
    })
  })

  it('quotes allowlisted names that are SQL keywords', async () => {
    await withPsql(async (psql) => {
      await psql.write('/* setup */ CREATE MATERIALIZED VIEW "order" AS SELECT 1 AS id')
      await psql.write('/* setup */ CREATE UNIQUE INDEX order_id ON "order" (id)')
      await refreshMaterializedView({
        pool: psql.writePool,
        viewName: 'order',
        allowedViews: ['order'],
      })
    })
  })

  it('rejects names outside the allowlist or unsafe, before connecting', async () => {
    const { pool } = fakePool([])
    await expect(
      refreshMaterializedView({ pool, viewName: 'other', allowedViews: ['mv'] }),
    ).rejects.toThrow('Invalid materialized view: other')
    await expect(
      refreshMaterializedView({ pool, viewName: 'Bad;', allowedViews: ['Bad;'] }),
    ).rejects.toThrow('Invalid materialized view: Bad;')
  })

  it('rejects retryably on contention and releases the client once', async () => {
    const { client, pool } = fakePool([{ rows: [{ locked: false }] }])
    await expect(
      refreshMaterializedView({ pool, viewName: 'mv', allowedViews: ['mv'] }),
    ).rejects.toThrow('contention; retryable')
    expect(client.release).toHaveBeenCalledOnce()
    expect(client.release).toHaveBeenCalledWith()
  })

  it('releases a healthy client after a refresh failure', async () => {
    const { client, pool } = fakePool([locked, new Error('refresh failed'), unlocked])
    await expect(
      refreshMaterializedView({ pool, viewName: 'mv', allowedViews: ['mv'] }),
    ).rejects.toThrow('refresh failed')
    expect(client.release).toHaveBeenCalledWith(undefined)
  })

  it('destroys the client when the unlock fails, reporting it beside a refresh failure', async () => {
    const reportError = vi.fn()
    const { client, pool } = fakePool([locked, new Error('refresh failed'), { rows: [] }])
    await expect(
      refreshMaterializedView({ pool, viewName: 'mv', allowedViews: ['mv'], reportError }),
    ).rejects.toThrow('refresh failed')
    expect(reportError).toHaveBeenCalledWith(
      new Error('Materialized view advisory lock was not held at release'),
    )
    expect(client.release).toHaveBeenCalledWith(expect.any(Error))
  })

  it('keeps the refresh failure when the reporter throws', async () => {
    const { pool } = fakePool([locked, new Error('refresh failed'), { rows: [] }])
    await expect(
      refreshMaterializedView({
        pool,
        viewName: 'mv',
        allowedViews: ['mv'],
        reportError: () => {
          throw new Error('reporter broke')
        },
      }),
    ).rejects.toThrow('refresh failed')
  })

  it('throws the unlock error when the refresh succeeded', async () => {
    const { pool } = fakePool([locked, { rows: [] }, new Error('unlock query failed')])
    await expect(
      refreshMaterializedView({ pool, viewName: 'mv', allowedViews: ['mv'] }),
    ).rejects.toThrow('unlock query failed')
  })

  it('destroys the client and wraps non-Error failures from the lock query', async () => {
    const { client, pool } = fakePool([])
    client.query.mockRejectedValueOnce('lock exploded')
    await expect(
      refreshMaterializedView({ pool, viewName: 'mv', allowedViews: ['mv'] }),
    ).rejects.toThrow('lock exploded')
    expect(client.release).toHaveBeenCalledWith(expect.any(Error))
  })
})
