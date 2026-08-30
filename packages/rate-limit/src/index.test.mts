import { afterAll, describe, expect, it } from 'vitest'
import {
  closeValkeyClients,
  RateLimiter as ValkyriesRateLimiter,
  retrySaturationError,
} from 'valkyries'
import {
  closeManagedValkeyClients,
  RateLimiter,
  retryRateLimiterSaturation,
  type RateLimiterAddAndCheckWindowsOptions,
  type RateLimiterOptions,
  type RateLimiterWindow,
  type RetryRateLimiterSaturationOptions,
} from './index.mts'

afterAll(closeManagedValkeyClients)

describe('@vouchington/rate-limit', () => {
  it('re-exports the Valkyries rate limiter', () => {
    expect(RateLimiter).toBe(ValkyriesRateLimiter)
    expect(closeManagedValkeyClients).toBe(closeValkeyClients)
    const limiter = new RateLimiter({ prefix: 'example', ttlSeconds: 60 })
    expect(limiter.getKey('account:1')).toBe('rate-limiter:example:{account:1}')
  })

  it('aliases saturation-only retry behavior', async () => {
    expect(retryRateLimiterSaturation).toBe(retrySaturationError)
    let calls = 0
    await expect(
      retryRateLimiterSaturation(
        async () => {
          calls += 1
          if (calls < 3) throw new Error('Reached maximum inflight requests')
          return 'ok'
        },
        { attempts: 3, delayMs: 0 },
      ),
    ).resolves.toBe('ok')
    expect(calls).toBe(3)

    const saturation = new Error('Reached maximum inflight requests')
    calls = 0
    await expect(
      retryRateLimiterSaturation(
        async () => {
          calls += 1
          throw saturation
        },
        { attempts: 2, delayMs: 0 },
      ),
    ).rejects.toBe(saturation)
    expect(calls).toBe(2)
  })

  it('preserves non-saturation errors and the public option types', async () => {
    const error = new Error('connection closed')
    const retry: RetryRateLimiterSaturationOptions = { attempts: 2, delayMs: 0 }
    const limiter: RateLimiterOptions = { prefix: 'example', ttlSeconds: 60 }
    const window: RateLimiterWindow = {
      prefix: 'example',
      id: 'account:1',
      ttlSeconds: 60,
      threshold: 10,
    }
    const windows: RateLimiterAddAndCheckWindowsOptions = { mode: 'record-all' }

    expect(retry).toEqual({ attempts: 2, delayMs: 0 })
    expect(limiter.prefix).toBe('example')
    expect(window.id).toBe('account:1')
    expect(windows.mode).toBe('record-all')
    await expect(retryRateLimiterSaturation(() => Promise.reject(error))).rejects.toBe(error)
  })
})
