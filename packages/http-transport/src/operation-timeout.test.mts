import { describe, expect, it, vi } from 'vitest'
import {
  createOperationTimeoutSignal,
  isTransportTimeoutError,
  raceWithAbortSignal,
  TRANSPORT_TIMEOUT_ERROR_CODES,
  withOperationTimeout,
} from './fetch.mts'

describe('isTransportTimeoutError', () => {
  it('recognizes AbortError, TimeoutError, and known Undici/socket timeout codes', () => {
    expect(isTransportTimeoutError(new DOMException('timed out', 'TimeoutError'))).toBe(true)
    expect(isTransportTimeoutError(new DOMException('aborted', 'AbortError'))).toBe(true)

    for (const code of TRANSPORT_TIMEOUT_ERROR_CODES) {
      const direct = Object.assign(new Error('timeout'), { code })
      expect(isTransportTimeoutError(direct)).toBe(true)
      expect(isTransportTimeoutError(new TypeError('fetch failed', { cause: direct }))).toBe(true)
    }
  })

  it('rejects non-timeout errors and non-Error values', () => {
    const nonTimeout = Object.assign(new Error('reset'), { code: 'ECONNRESET' })
    expect(isTransportTimeoutError(nonTimeout)).toBe(false)
    expect(isTransportTimeoutError(new TypeError('fetch failed', { cause: nonTimeout }))).toBe(
      false,
    )
    expect(isTransportTimeoutError(new Error('plain'))).toBe(false)
    expect(isTransportTimeoutError(new Error('non-error cause', { cause: 'ETIMEDOUT' }))).toBe(
      false,
    )
    expect(isTransportTimeoutError('TimeoutError')).toBe(false)
  })
})

describe('createOperationTimeoutSignal', () => {
  it('creates a fresh timeout signal and composes an optional parent signal', () => {
    const standalone = createOperationTimeoutSignal(5_000)
    expect(standalone.aborted).toBe(false)

    const parent = new AbortController()
    const first = createOperationTimeoutSignal(5_000, parent.signal)
    const second = createOperationTimeoutSignal(5_000, parent.signal)
    expect(first).not.toBe(parent.signal)
    expect(second).not.toBe(first)

    const reason = new Error('parent cancelled')
    parent.abort(reason)
    expect(first.aborted).toBe(true)
    expect(second.aborted).toBe(true)
    expect(first.reason).toBe(reason)
  })
})

describe('raceWithAbortSignal', () => {
  it('resolves and cleans up the abort listener when the operation finishes first', async () => {
    const controller = new AbortController()
    const removeSpy = vi.spyOn(controller.signal, 'removeEventListener')
    await expect(raceWithAbortSignal(Promise.resolve('ok'), controller.signal)).resolves.toBe('ok')
    expect(removeSpy).toHaveBeenCalledOnce()
  })

  it('rejects with the exact abort reason when the signal aborts first or is already aborted', async () => {
    const alreadyReason = new Error('already')
    const lateReject = Promise.reject(new Error('ignored'))
    await expect(raceWithAbortSignal(lateReject, AbortSignal.abort(alreadyReason))).rejects.toBe(
      alreadyReason,
    )

    const controller = new AbortController()
    const pending = new Promise<string>(() => {})
    const raced = raceWithAbortSignal(pending, controller.signal)
    const reason = { custom: 'abort-reason' }
    controller.abort(reason)
    await expect(raced).rejects.toBe(reason)
  })
})

describe('withOperationTimeout', () => {
  it('returns the operation result when it settles in time', async () => {
    const result = await withOperationTimeout({ timeoutMs: 5_000 }, async (signal) => {
      expect(signal.aborted).toBe(false)
      return 'done'
    })
    expect(result).toBe('done')
  })

  it('maps transport timeout errors when mapTimeoutError is provided', async () => {
    const cause = new DOMException('Request timed out', 'TimeoutError')
    const mapped = new Error('upstream 502', { cause })
    const mapTimeoutError = vi.fn(() => mapped)

    await expect(
      withOperationTimeout({ timeoutMs: 5_000, mapTimeoutError }, async () => {
        throw cause
      }),
    ).rejects.toBe(mapped)
    expect(mapTimeoutError).toHaveBeenCalledWith(cause)
  })

  it('aborts hung operations when the local timeout expires', async () => {
    const mapped = new Error('timed out')
    await expect(
      withOperationTimeout(
        { timeoutMs: 10, mapTimeoutError: () => mapped },
        () => new Promise<string>(() => {}),
      ),
    ).rejects.toBe(mapped)
  })

  it('rethrows non-timeout errors and custom parent abort reasons unchanged', async () => {
    const parent = new AbortController()
    const reason = new Error('caller cancelled')
    parent.abort(reason)

    const mapTimeoutError = vi.fn(() => new Error('should not map'))
    await expect(
      withOperationTimeout(
        { timeoutMs: 5_000, signal: parent.signal, mapTimeoutError },
        async () => 'ok',
      ),
    ).rejects.toBe(reason)
    expect(mapTimeoutError).not.toHaveBeenCalled()

    await expect(
      withOperationTimeout({ timeoutMs: 5_000 }, async () => {
        throw new DOMException('Request timed out', 'TimeoutError')
      }),
    ).rejects.toMatchObject({ name: 'TimeoutError' })
  })
})
