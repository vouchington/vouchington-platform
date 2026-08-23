import { describe, expect, it } from 'vitest'

import {
  connectWithRetry,
  getConnectRetryOptions,
  isRetryableConnectError,
  withConnectRetry,
} from './connect-with-retry.mts'

describe('isRetryableConnectError', () => {
  it('matches known timeout messages', () => {
    expect(
      isRetryableConnectError(new Error('Connection terminated due to connection timeout')),
    ).toBe(true)
    expect(isRetryableConnectError(new Error('timeout exceeded when trying to connect'))).toBe(true)
  })

  it('rejects unrelated errors', () => {
    expect(isRetryableConnectError(new Error('password authentication failed'))).toBe(false)
    expect(isRetryableConnectError('Connection terminated due to connection timeout')).toBe(false)
    expect(isRetryableConnectError(undefined)).toBe(false)
  })
})

describe('withConnectRetry', () => {
  it('returns the first success', async () => {
    let calls = 0
    await expect(
      withConnectRetry(
        async () => {
          calls++
          return 'ok'
        },
        { attempts: 3, delayMs: 0 },
      ),
    ).resolves.toBe('ok')
    expect(calls).toBe(1)
  })

  it('retries a retryable error then succeeds', async () => {
    let calls = 0
    await expect(
      withConnectRetry(
        async () => {
          calls++
          if (calls === 1) throw new Error('Connection terminated due to connection timeout')
          return 'ok'
        },
        { attempts: 3, delayMs: 0 },
      ),
    ).resolves.toBe('ok')
    expect(calls).toBe(2)
  })

  it('throws immediately for a non-retryable error', async () => {
    const authError = new Error('password authentication failed')
    await expect(
      withConnectRetry(
        async () => {
          throw authError
        },
        { attempts: 3, delayMs: 0 },
      ),
    ).rejects.toBe(authError)
  })

  it('delays between retryable attempts', async () => {
    let calls = 0
    await expect(
      withConnectRetry(
        async () => {
          calls++
          if (calls === 1) throw new Error('timeout exceeded when trying to connect')
          return 'ok'
        },
        { attempts: 2, delayMs: 1 },
      ),
    ).resolves.toBe('ok')
    expect(calls).toBe(2)
  })

  it('throws after exhausting attempts', async () => {
    const timeoutError = new Error('timeout exceeded when trying to connect')
    let calls = 0
    await expect(
      withConnectRetry(
        async () => {
          calls++
          throw timeoutError
        },
        { attempts: 3, delayMs: 0 },
      ),
    ).rejects.toBe(timeoutError)
    expect(calls).toBe(3)
  })
})

describe('getConnectRetryOptions', () => {
  it('parses env values and rejects invalid ones', () => {
    expect(getConnectRetryOptions({})).toEqual({ attempts: 5, delayMs: 1_000 })
    expect(getConnectRetryOptions({ PG_CONNECT_RETRY_ATTEMPTS: '' })).toEqual({
      attempts: 5,
      delayMs: 1_000,
    })
    expect(
      getConnectRetryOptions({
        PG_CONNECT_RETRY_ATTEMPTS: '3',
        PG_CONNECT_RETRY_DELAY_MS: '0',
      }),
    ).toEqual({ attempts: 3, delayMs: 0 })
    expect(() => getConnectRetryOptions({ PG_CONNECT_RETRY_ATTEMPTS: '0' })).toThrow(
      'PG_CONNECT_RETRY_ATTEMPTS must be a positive integer, got "0"',
    )
    expect(() => getConnectRetryOptions({ PG_CONNECT_RETRY_DELAY_MS: '-1' })).toThrow(
      'PG_CONNECT_RETRY_DELAY_MS must be a non-negative integer, got "-1"',
    )
  })
})

describe('connectWithRetry', () => {
  it('retries pool.connect() then returns the client', async () => {
    let calls = 0
    const client = { released: false }
    const result = await connectWithRetry(
      {
        connect: async () => {
          calls++
          if (calls === 1) throw new Error('Connection terminated due to connection timeout')
          return client as never
        },
      },
      { attempts: 3, delayMs: 0 },
    )
    expect(result).toBe(client)
    expect(calls).toBe(2)
  })
})
