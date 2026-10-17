import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  isExpectedWorkerResponse,
  isWebPushBinding,
  isWebPushWorkerState,
  requestWorkerState,
  withWebLock,
} from './web-push-binding.mts'

const TYPE = 'app:web-push'
const binding = { endpoint: 'https://p.example/1', subscription_id: 's1' }

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('state guards', () => {
  it('validates bindings', () => {
    expect(isWebPushBinding(binding)).toBe(true)
    expect(isWebPushBinding({ ...binding, endpoint: '' })).toBe(false)
    expect(isWebPushBinding({ ...binding, subscription_id: 1 })).toBe(false)
    expect(isWebPushBinding(null)).toBe(false)
    expect(isWebPushBinding('x')).toBe(false)
  })

  it('validates worker states', () => {
    expect(isWebPushWorkerState({ status: 'uninitialized' })).toBe(true)
    expect(isWebPushWorkerState({ status: 'uninitialized', binding })).toBe(false)
    expect(isWebPushWorkerState({ status: 'bound', binding, revision: 'r' })).toBe(true)
    expect(isWebPushWorkerState({ status: 'bound', revision: 'r' })).toBe(false)
    expect(isWebPushWorkerState({ status: 'disabled', revision: 'r' })).toBe(true)
    expect(isWebPushWorkerState({ status: 'reconciling', binding, revision: 'r' })).toBe(true)
    expect(isWebPushWorkerState({ status: 'reconciling', binding: {}, revision: 'r' })).toBe(false)
    expect(isWebPushWorkerState({ status: 'disabled', revision: '' })).toBe(false)
    expect(isWebPushWorkerState({ status: 'other', revision: 'r' })).toBe(false)
    expect(isWebPushWorkerState(null)).toBe(false)
    expect(isWebPushWorkerState(1)).toBe(false)
  })
})

describe('isExpectedWorkerResponse', () => {
  const ok = (state: unknown) => ({ type: TYPE, version: 1 as const, ok: true, state })
  const bound = { status: 'bound', binding, revision: 'r1' }

  it('checks the envelope', () => {
    const input = { action: 'read-or-initialize' as const }
    expect(isExpectedWorkerResponse(undefined, input, TYPE)).toBe(false)
    expect(isExpectedWorkerResponse({ ...ok(bound), type: 'x' }, input, TYPE)).toBe(false)
    expect(isExpectedWorkerResponse({ ...ok(bound), version: 2 as 1 }, input, TYPE)).toBe(false)
    expect(isExpectedWorkerResponse({ ...ok(bound), ok: false }, input, TYPE)).toBe(false)
    expect(isExpectedWorkerResponse(ok({ status: 'x' }), input, TYPE)).toBe(false)
    expect(isExpectedWorkerResponse(ok(bound), input, TYPE)).toBe(true)
  })

  it('checks action-specific expectations', () => {
    const bind = { action: 'bind' as const, binding, expected_revision: 'r1' }
    expect(isExpectedWorkerResponse(ok(bound), bind, TYPE)).toBe(true)
    expect(isExpectedWorkerResponse(ok({ ...bound, revision: 'r2' }), bind, TYPE)).toBe(false)
    expect(
      isExpectedWorkerResponse(
        ok({ ...bound, binding: { ...binding, subscription_id: 's2' } }),
        bind,
        TYPE,
      ),
    ).toBe(false)
    expect(
      isExpectedWorkerResponse(
        ok({ ...bound, binding: { ...binding, endpoint: 'https://other' } }),
        bind,
        TYPE,
      ),
    ).toBe(false)
    expect(isExpectedWorkerResponse(ok({ status: 'uninitialized' }), bind, TYPE)).toBe(false)

    expect(
      isExpectedWorkerResponse(
        ok({ status: 'disabled', revision: 'r' }),
        { action: 'clear' },
        TYPE,
      ),
    ).toBe(true)
    expect(isExpectedWorkerResponse(ok(bound), { action: 'clear' }, TYPE)).toBe(false)

    const begin = { action: 'begin-reconciliation' as const }
    expect(
      isExpectedWorkerResponse(ok({ status: 'reconciling', revision: 'r' }), begin, TYPE),
    ).toBe(true)
    expect(isExpectedWorkerResponse(ok(bound), begin, TYPE)).toBe(false)
  })
})

type Worker = { postMessage: (message: unknown, transfer: unknown[]) => void }

function workerReplying(reply: (message: unknown) => unknown): Worker {
  return {
    postMessage: (message, [port]) => {
      const response = reply(message)
      const target = port as MessagePort
      target.postMessage(response)
    },
  }
}

describe('requestWorkerState', () => {
  it('rejects without an active worker', async () => {
    await expect(
      requestWorkerState({ active: null }, { action: 'clear' }, { messageType: TYPE }),
    ).rejects.toThrow('unavailable')
  })

  it('resolves the acknowledged state and sends a versioned request', async () => {
    const seen: unknown[] = []
    const active = workerReplying((message) => {
      seen.push(message)
      return { type: TYPE, version: 1, ok: true, state: { status: 'disabled', revision: 'r' } }
    })
    await expect(
      requestWorkerState({ active }, { action: 'clear' }, { messageType: TYPE }),
    ).resolves.toEqual({ status: 'disabled', revision: 'r' })
    expect(seen).toEqual([{ type: TYPE, version: 1, action: 'clear' }])
  })

  it('rejects with the worker error or a default message', async () => {
    const withError = workerReplying(() => ({ type: TYPE, version: 1, ok: false, error: 'denied' }))
    await expect(
      requestWorkerState({ active: withError }, { action: 'clear' }, { messageType: TYPE }),
    ).rejects.toThrow('denied')
    const bare = workerReplying(() => ({ type: 'wrong' }))
    await expect(
      requestWorkerState({ active: bare }, { action: 'clear' }, { messageType: TYPE }),
    ).rejects.toThrow('rejected the push binding request')
    const empty = workerReplying(() => undefined)
    await expect(
      requestWorkerState({ active: empty }, { action: 'clear' }, { messageType: TYPE }),
    ).rejects.toThrow('rejected the push binding request')
  })

  it('times out when the worker never answers', async () => {
    vi.useFakeTimers()
    const silent: Worker = { postMessage: () => undefined }
    const pending = requestWorkerState(
      { active: silent },
      { action: 'clear' },
      { messageType: TYPE, timeoutMs: 50 },
    )
    const assertion = expect(pending).rejects.toThrow('did not acknowledge')
    await vi.advanceTimersByTimeAsync(50)
    await assertion
    const defaulted = requestWorkerState(
      { active: silent },
      { action: 'clear' },
      { messageType: TYPE },
    )
    const second = expect(defaulted).rejects.toThrow('did not acknowledge')
    await vi.advanceTimersByTimeAsync(5000)
    await second
  })
})

describe('withWebLock', () => {
  it('runs under the named lock', async () => {
    const request = vi.fn(async (_name: string, op: () => Promise<number>) => op())
    vi.stubGlobal('navigator', { locks: { request } })
    await expect(withWebLock('lock', async () => 7)).resolves.toBe(7)
    expect(request).toHaveBeenCalledWith('lock', expect.any(Function))
  })

  it('fails closed without a lock manager', async () => {
    vi.stubGlobal('navigator', {})
    await expect(withWebLock('lock', async () => 1)).rejects.toThrow('cannot safely coordinate')
    vi.stubGlobal('navigator', undefined)
    await expect(withWebLock('lock', async () => 1)).rejects.toThrow('cannot safely coordinate')
  })
})
