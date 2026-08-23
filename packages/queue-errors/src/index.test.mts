import { describe, expect, it } from 'vitest'
import { UnrecoverableError as GlideUnrecoverableError, Worker } from 'glide-mq'
import {
  UnrecoverableError,
  getHttpStatus,
  handleRateLimitedError,
  isRetryableHttpStatus,
  unrecoverable,
  wrapHttpForRetry,
  type QueueRateLimiter,
} from './index.mts'

describe('unrecoverable', () => {
  it("throws glide-mq's terminal error with the source message", () => {
    expect(UnrecoverableError).toBe(GlideUnrecoverableError)
    expect(() => unrecoverable({ message: 'invalid input' })).toThrow(GlideUnrecoverableError)
    expect(() => unrecoverable({ message: 'invalid input' })).toThrow('invalid input')
    expect(() => unrecoverable('string failure')).toThrow('string failure')
  })

  it('uses an explicit message and preserves an Error stack', () => {
    const source = new Error('source')
    let caught: unknown
    try {
      unrecoverable(source, 'terminal')
    } catch (error) {
      caught = error
    }
    expect(caught).toMatchObject({ message: 'terminal', stack: source.stack })
    const stackless = new Error('stackless')
    delete stackless.stack
    expect(() => unrecoverable(stackless)).toThrow('stackless')
    const plain = { message: 'plain', stack: 'plain stack' }
    expect(catchThrown(() => unrecoverable(plain))).toMatchObject({ stack: plain.stack })
  })
})

describe('HTTP retry classification', () => {
  it('makes ordinary client failures terminal', () => {
    expect(() => wrapHttpForRetry({ status: 404, message: 'missing' })).toThrow(
      GlideUnrecoverableError,
    )
    expect(getHttpStatus({ status: 400, statusCode: 500 })).toBe(400)
    expect(getHttpStatus({ statusCode: 400 })).toBe(400)
    expect(getHttpStatus({ status: 600 })).toBeUndefined()
    expect(getHttpStatus({ status: '400' })).toBeUndefined()
    expect(getHttpStatus(null)).toBeUndefined()
  })

  it('rethrows transient statuses and unknown failures', () => {
    for (const status of [408, 429, 500]) {
      const error = Object.assign(new Error(`status ${status}`), { status })
      expect(catchThrown(() => wrapHttpForRetry(error))).toBe(error)
      expect(isRetryableHttpStatus(status)).toBe(true)
    }
    const unknown = new Error('network failed')
    expect(catchThrown(() => wrapHttpForRetry(unknown))).toBe(unknown)
    expect(isRetryableHttpStatus(404)).toBe(false)
  })

  it('supports caller-provided status extraction and retry policy', () => {
    const providerError = { code: 'conflict' }
    expect(() =>
      wrapHttpForRetry(providerError, {
        getStatus: (error) => ((error as { code?: string }).code === 'conflict' ? 409 : undefined),
        isRetryableStatus: (status) => status === 409,
      }),
    ).toThrow(providerError)
    expect(() =>
      wrapHttpForRetry(providerError, {
        getStatus: () => 418,
        isRetryableStatus: () => false,
      }),
    ).toThrow(GlideUnrecoverableError)
    expect(() =>
      wrapHttpForRetry(
        { status: 503, message: 'overridden server failure' },
        {
          isRetryableStatus: () => false,
        },
      ),
    ).toThrow(GlideUnrecoverableError)
  })
})

describe('queue rate limiting', () => {
  it('pauses the worker and signals glide-mq when the caller classifies a limit', async () => {
    const calls: number[] = []
    const worker: QueueRateLimiter = { rateLimit: async (duration) => void calls.push(duration) }
    const error = await catchRejected(
      handleRateLimitedError({ retryAfter: true }, worker, {
        cooldownMs: 30_000,
        isRateLimited: (value) => (value as { retryAfter?: boolean }).retryAfter === true,
      }),
    )
    expect(error).toBeInstanceOf(Worker.RateLimitError)
    expect(error).toMatchObject({ delayMs: 30_000 })
    expect(calls).toEqual([30_000])
  })

  it('uses the caller fallback when the error is not rate limited', async () => {
    const worker: QueueRateLimiter = { rateLimit: async () => undefined }
    const error = new Error('not limited')
    await expect(
      handleRateLimitedError(error, worker, {
        cooldownMs: 1,
        isRateLimited: () => false,
        onUnhandled: (source) => {
          throw source
        },
      }),
    ).rejects.toThrow(error)
    await expect(
      handleRateLimitedError({ status: 404, message: 'missing' }, worker, {
        cooldownMs: 1,
        isRateLimited: () => false,
      }),
    ).rejects.toBeInstanceOf(GlideUnrecoverableError)
  })

  it('rejects invalid cooldowns before touching the worker', async () => {
    let called = false
    const worker: QueueRateLimiter = {
      rateLimit: async () => {
        called = true
      },
    }
    await expect(
      handleRateLimitedError(new Error('limited'), worker, {
        cooldownMs: 0,
        isRateLimited: () => true,
      }),
    ).rejects.toThrow('cooldownMs must be a positive safe integer')
    await expect(
      handleRateLimitedError(new Error('limited'), worker, {
        cooldownMs: Number.NaN,
        isRateLimited: () => true,
      }),
    ).rejects.toThrow('cooldownMs must be a positive safe integer')
    expect(called).toBe(false)
  })

  it('preserves a worker rate-limit failure', async () => {
    const failure = new Error('worker unavailable')
    const worker: QueueRateLimiter = {
      rateLimit: async () => {
        throw failure
      },
    }
    await expect(
      handleRateLimitedError(new Error('limited'), worker, {
        cooldownMs: 1,
        isRateLimited: () => true,
      }),
    ).rejects.toThrow(failure)
  })
})

function catchThrown(callback: () => never): unknown {
  try {
    callback()
  } catch (error) {
    return error
  }
  throw new Error('Expected callback to throw')
}

async function catchRejected(promise: Promise<never>): Promise<unknown> {
  try {
    await promise
  } catch (error) {
    return error
  }
  throw new Error('Expected promise to reject')
}
