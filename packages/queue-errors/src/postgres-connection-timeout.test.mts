import { describe, expect, it } from 'vitest'
import { MAX_RATE_LIMIT_DEFERRAL_AGE_MS } from './rate-limit.mts'
import { deferPostgresConnectionTimeout } from './postgres-connection-timeout.mts'

describe('deferPostgresConnectionTimeout', () => {
  it('returns the result when the run succeeds', async () => {
    await expect(
      deferPostgresConnectionTimeout({ timestamp: Date.now() }, async () => 1),
    ).resolves.toBe(1)
  })

  it('preserves the original connection timeout as the deferral cause', async () => {
    const cause = new Error('Connection terminated due to connection timeout')
    const signal = await deferPostgresConnectionTimeout({ timestamp: Date.now() }, async () => {
      throw cause
    }).catch((err: unknown) => err)

    expect(signal).toMatchObject({ name: 'RateLimitError', delayMs: 30_000, cause })
  })

  it('leaves unrelated errors and non-errors on the ordinary retry path', async () => {
    const cause = new Error('relation does not exist')
    await expect(
      deferPostgresConnectionTimeout({ timestamp: Date.now() }, async () => {
        throw cause
      }),
    ).rejects.toBe(cause)
    await expect(
      deferPostgresConnectionTimeout({ timestamp: Date.now() }, async () => {
        // oxlint-disable-next-line typescript/only-throw-error -- exercises a non-Error rejection.
        throw 'boom'
      }),
    ).rejects.toBe('boom')
  })

  it('spends attempts after the deferral age is exhausted', async () => {
    const cause = new Error('timeout exceeded when trying to connect')
    const oldJob = { timestamp: Date.now() - MAX_RATE_LIMIT_DEFERRAL_AGE_MS - 1_000 }
    await expect(
      deferPostgresConnectionTimeout(oldJob, async () => {
        throw cause
      }),
    ).rejects.toBe(cause)
  })

  it('accepts caller messages and retry delay', async () => {
    const cause = new Error('pool exhausted')
    const signal = await deferPostgresConnectionTimeout(
      { timestamp: Date.now() },
      async () => {
        throw cause
      },
      { messages: ['pool exhausted'], retryDelayMs: 5_000 },
    ).catch((err: unknown) => err)
    expect(signal).toMatchObject({ delayMs: 5_000, cause })
  })
})
