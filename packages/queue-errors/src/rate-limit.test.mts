import { Worker } from 'glide-mq'
import { describe, expect, it, vi } from 'vitest'
import {
  MAX_RATE_LIMIT_DEFERRAL_AGE_MS,
  MAX_RATE_LIMIT_DELAY_MS,
  MIN_RATE_LIMIT_DELAY_MS,
  DEFAULT_RATE_LIMIT_DELAY_MS,
  boundRateLimitDeferral,
  clampRateLimitDelayMs,
  createRateLimitError,
  deferJobForRateLimit,
  throwRateLimited,
} from './rate-limit.mts'

function thrownBy(callback: () => void): unknown {
  try {
    callback()
  } catch (err) {
    return err
  }
  throw new Error('Expected the callback to throw')
}

// Stands in for GlideMQ's DelayedError, which job.moveToDelayed() always rejects with.
class StubDelayedError extends Error {}
class OtherRateLimitError extends Error {}

describe('clampRateLimitDelayMs', () => {
  it.each([
    [undefined, DEFAULT_RATE_LIMIT_DELAY_MS],
    [null, DEFAULT_RATE_LIMIT_DELAY_MS],
    [Number.NaN, DEFAULT_RATE_LIMIT_DELAY_MS],
    [Number.POSITIVE_INFINITY, DEFAULT_RATE_LIMIT_DELAY_MS],
    [0, MIN_RATE_LIMIT_DELAY_MS],
    [250, MIN_RATE_LIMIT_DELAY_MS],
    [30_000, 30_000],
    [1_500.2, 1_501],
    [24 * 60 * 60_000, MAX_RATE_LIMIT_DELAY_MS],
  ])('maps %s to %s', (retryAfterMs, expected) => {
    expect(clampRateLimitDelayMs(retryAfterMs)).toBe(expected)
  })

  it('uses caller-supplied bounds', () => {
    const options = { minMs: 10, defaultMs: 20, maxMs: 30 }
    expect(clampRateLimitDelayMs(undefined, options)).toBe(20)
    expect(clampRateLimitDelayMs(1, options)).toBe(10)
    expect(clampRateLimitDelayMs(99, options)).toBe(30)
  })

  it('clamps the default fallback into the window', () => {
    expect(clampRateLimitDelayMs(undefined, { minMs: 5_000, defaultMs: 1_000 })).toBe(5_000)
    expect(clampRateLimitDelayMs(null, { defaultMs: 0 })).toBe(MIN_RATE_LIMIT_DELAY_MS)
    expect(clampRateLimitDelayMs(undefined, { defaultMs: 99, maxMs: 50, minMs: 1 })).toBe(50)
  })
})

describe('createRateLimitError and throwRateLimited', () => {
  it('builds the glide-mq signal carrying the clamped wait and the cause', () => {
    const cause = new Error('429 from provider')
    const error = createRateLimitError(45_000, cause)

    expect(error).toBeInstanceOf(Worker.RateLimitError)
    expect(error).toMatchObject({ name: 'RateLimitError', delayMs: 45_000, cause })
    expect(createRateLimitError()).toMatchObject({ delayMs: DEFAULT_RATE_LIMIT_DELAY_MS })
    expect('cause' in createRateLimitError()).toBe(false)
  })

  it('uses an injected signal class and throws it', () => {
    const thrown = thrownBy(() =>
      throwRateLimited(5_000, undefined, { RateLimitError: OtherRateLimitError }),
    )
    expect(thrown).toBeInstanceOf(OtherRateLimitError)
    expect(thrown).toMatchObject({ delayMs: 5_000 })
    expect(thrownBy(() => throwRateLimited(2_000))).toBeInstanceOf(Worker.RateLimitError)
  })
})

describe('deferJobForRateLimit', () => {
  it('parks the job until the clamped wait has passed and never resolves', async () => {
    const moveToDelayed = vi
      .fn<(timestamp: number) => Promise<never>>()
      .mockImplementation(async (timestamp) => {
        throw new StubDelayedError(String(timestamp))
      })
    const before = Date.now()

    await expect(deferJobForRateLimit({ moveToDelayed }, 20_000)).rejects.toBeInstanceOf(
      StubDelayedError,
    )

    const [delayedUntil] = moveToDelayed.mock.calls[0]!
    expect(delayedUntil).toBeGreaterThanOrEqual(before + 20_000)
    expect(delayedUntil).toBeLessThanOrEqual(Date.now() + 20_000)
  })

  it('applies caller bounds', async () => {
    const moveToDelayed = vi
      .fn<(timestamp: number) => Promise<never>>()
      .mockRejectedValue(new Error('x'))
    await deferJobForRateLimit({ moveToDelayed }, undefined, { defaultMs: 7_000 }).catch(() => {})
    const [delayedUntil] = moveToDelayed.mock.calls[0]!
    expect(delayedUntil - Date.now()).toBeLessThanOrEqual(7_000)
    expect(delayedUntil - Date.now()).toBeGreaterThan(6_000)
  })
})

describe('boundRateLimitDeferral', () => {
  const oldJob = { timestamp: Date.now() - MAX_RATE_LIMIT_DEFERRAL_AGE_MS - 1_000 }

  it('passes a result and a young job signal through', async () => {
    await expect(boundRateLimitDeferral({ timestamp: Date.now() }, async () => 'ok')).resolves.toBe(
      'ok',
    )
    const signal = createRateLimitError(1_000)
    await expect(
      boundRateLimitDeferral({ timestamp: Date.now() }, async () => {
        throw signal
      }),
    ).rejects.toBe(signal)
  })

  it('treats a missing timestamp as an unknown age', async () => {
    const signal = createRateLimitError(1_000)
    await expect(
      boundRateLimitDeferral({ timestamp: 0 }, async () => {
        throw signal
      }),
    ).rejects.toBe(signal)
  })

  it('turns an expired signal into its cause, or a new error without one', async () => {
    const cause = new Error('upstream 429')
    await expect(
      boundRateLimitDeferral(oldJob, async () => {
        throw createRateLimitError(1_000, cause)
      }),
    ).rejects.toBe(cause)
    const bare = createRateLimitError(1_000)
    await expect(
      boundRateLimitDeferral(oldJob, async () => {
        throw bare
      }),
    ).rejects.toMatchObject({ message: 'Rate limit deferral age exceeded', cause: bare })
  })

  it('rethrows non-signal errors even on an old job', async () => {
    const failure = new Error('other')
    await expect(
      boundRateLimitDeferral(oldJob, async () => {
        throw failure
      }),
    ).rejects.toBe(failure)
  })

  it('honors caller max age and signal class', async () => {
    const signal = Object.assign(new OtherRateLimitError('x'), { cause: new Error('c') })
    await expect(
      boundRateLimitDeferral(
        { timestamp: Date.now() - 5_000 },
        async () => {
          throw signal
        },
        { maxAgeMs: 1_000, RateLimitError: OtherRateLimitError },
      ),
    ).rejects.toBe(signal.cause)
  })
})
