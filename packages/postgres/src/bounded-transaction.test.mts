import { describe, expect, it, vi } from 'vitest'

import { runBoundedTransactionWithClient } from './bounded-transaction.mts'

const options = { connectionTimeoutMs: 100, statementTimeoutMs: 100 }

describe('bounded transaction cleanup', () => {
  it('releases normally when rollback succeeds', async () => {
    const primaryError = new Error('operation failed')
    const fixture = createClientFixture()
    await expect(
      runBoundedTransactionWithClient(options, fixture.client, async () => {
        throw primaryError
      }),
    ).rejects.toBe(primaryError)
    expect(fixture.queries.at(-1)).toContain('ROLLBACK')
    expect(fixture.release).toHaveBeenCalledWith()
  })

  it('destroys the client when rollback fails', async () => {
    const primaryError = new Error('operation failed')
    const rollbackError = new Error('rollback failed')
    const fixture = createClientFixture({ rollbackError })
    const reportError = vi.fn<(error: Error) => void>(() => {
      throw new Error('reporter failed')
    })
    await expect(
      runBoundedTransactionWithClient(
        options,
        fixture.client,
        async () => {
          throw primaryError
        },
        { env: {}, errorHandler: reportError },
      ),
    ).rejects.toBe(primaryError)
    expect(fixture.release).toHaveBeenCalledWith(true)
    expect(reportError).toHaveBeenCalled()
  })

  it('commits a successful handler', async () => {
    const fixture = createClientFixture()
    await expect(
      runBoundedTransactionWithClient(options, fixture.client, async (query) => {
        await query('/* inner */ SELECT 1')
        return 7
      }),
    ).resolves.toBe(7)
    expect(fixture.queries.some((query) => query.includes('COMMIT'))).toBe(true)
  })

  it('throws a wrapped non-Error transaction failure', async () => {
    const fixture = createClientFixture()
    await expect(
      runBoundedTransactionWithClient(options, fixture.client, async (query) => {
        await query('/* inner */ SELECT 1')
        fixture.failNextQuery('nope')
        void query('/* inner */ SELECT 1')
        return 1
      }),
    ).rejects.toThrow('Transaction failed: nope')
  })

  it('does not roll back when BEGIN fails', async () => {
    const primaryError = new Error('begin failed')
    const fixture = createClientFixture()
    fixture.failNextQuery(primaryError)
    await expect(
      runBoundedTransactionWithClient(options, fixture.client, async () => 1),
    ).rejects.toBe(primaryError)
    expect(fixture.queries.some((query) => query.includes('ROLLBACK'))).toBe(false)
    expect(fixture.release).toHaveBeenCalledWith()
  })

  it('destroys the client when rollback fails without a reporter', async () => {
    const primaryError = new Error('operation failed')
    const fixture = createClientFixture({ rollbackError: new Error('rollback failed') })
    await expect(
      runBoundedTransactionWithClient(options, fixture.client, async () => {
        throw primaryError
      }),
    ).rejects.toBe(primaryError)
    expect(fixture.release).toHaveBeenCalledWith(true)
  })

  it('rethrows a later queued query after a non-Error failure', async () => {
    const fixture = createClientFixture()
    await expect(
      runBoundedTransactionWithClient(options, fixture.client, async (query) => {
        await query('/* inner */ SELECT 1')
        fixture.failNextQuery('nope')
        void query('/* inner */ SELECT 1')
        await expect(query('/* later */ SELECT 1')).rejects.toThrow('Transaction failed: nope')
        return 1
      }),
    ).rejects.toThrow('Transaction failed: nope')
  })

  it('rethrows a later queued query after an Error failure', async () => {
    const fixture = createClientFixture()
    const queued = new Error('queued')
    await expect(
      runBoundedTransactionWithClient(options, fixture.client, async (query) => {
        await query('/* inner */ SELECT 1')
        fixture.failNextQuery(queued)
        void query('/* inner */ SELECT 1')
        await expect(query('/* later */ SELECT 1')).rejects.toBe(queued)
        return 1
      }),
    ).rejects.toBe(queued)
  })

  it('normalizes a non-Error rollback failure', async () => {
    const primaryError = new Error('operation failed')
    const fixture = createClientFixture({ rollbackError: 'rollback failed' })
    const reportError = vi.fn()
    await expect(
      runBoundedTransactionWithClient(
        options,
        fixture.client,
        async () => {
          throw primaryError
        },
        { env: {}, errorHandler: reportError },
      ),
    ).rejects.toBe(primaryError)
    expect(reportError).toHaveBeenCalled()
  })
})

function createClientFixture(options?: { rollbackError?: unknown }) {
  const queries: string[] = []
  const release = vi.fn()
  let failNext: unknown
  const client = {
    query: async (input: { text?: string } | string) => {
      const text = typeof input === 'string' ? input : (input.text ?? '')
      queries.push(text)
      if (failNext !== undefined) {
        const error = failNext
        failNext = undefined
        throw error
      }
      if (text.includes('ROLLBACK') && options?.rollbackError) throw options.rollbackError
      return { rows: [], rowCount: 0 }
    },
    release,
  }
  return {
    client: client as never,
    queries,
    release,
    failNextQuery(value: unknown) {
      failNext = value
    },
  }
}
