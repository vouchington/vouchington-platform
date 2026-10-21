import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  ServiceWorkerActivationTimeoutError,
  waitForActiveServiceWorker,
} from './service-worker-activation.mts'

describe('waitForActiveServiceWorker', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('returns a registration that is already active', async () => {
    const registration = makeRegistration({ active: makeWorker().worker })

    await expect(waitForActiveServiceWorker(registration)).resolves.toBe(registration)
  })

  it('returns a ready registration with no timeout', async () => {
    const ready = makeRegistration({ active: makeWorker().worker })
    const input = makeRegistration({})
    const result = waitForActiveServiceWorker(input, {
      serviceWorker: deferredContainer(ready),
    })

    await expect(result).resolves.toBe(ready)
  })

  it('uses navigator.serviceWorker.ready when no container is injected', async () => {
    const ready = makeRegistration({ active: makeWorker().worker })
    vi.stubGlobal('navigator', { serviceWorker: { ready: Promise.resolve(ready) } })

    await expect(waitForActiveServiceWorker(makeRegistration({}))).resolves.toBe(ready)
  })

  it('resolves the ready fallback before the timeout and clears that timer', async () => {
    vi.useFakeTimers()
    const clearTimeout = vi.spyOn(globalThis, 'clearTimeout')
    const ready = makeRegistration({ active: makeWorker().worker })
    const result = waitForActiveServiceWorker(makeRegistration({}), {
      timeoutMs: 5000,
      serviceWorker: { ready: Promise.resolve(ready) },
    })

    await expect(result).resolves.toBe(ready)
    expect(clearTimeout).toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(5000)
    await expect(result).resolves.toBe(ready)
  })

  it('times out the ready fallback and clears the timer', async () => {
    vi.useFakeTimers()
    const clearTimeout = vi.spyOn(globalThis, 'clearTimeout')
    const result = waitForActiveServiceWorker(makeRegistration({}), {
      timeoutMs: 5000,
      serviceWorker: { ready: new Promise<ServiceWorkerRegistration>(() => undefined) },
    })
    const rejection = result.catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(5000)

    await expect(rejection).resolves.toBeInstanceOf(ServiceWorkerActivationTimeoutError)
    expect(clearTimeout).toHaveBeenCalled()
  })

  it('returns a replacement that is already activated without listening', async () => {
    const replacement = makeWorker('activated')
    const addEventListener = vi.spyOn(replacement.worker, 'addEventListener')
    const registration = makeRegistration({ installing: replacement.worker })

    await expect(waitForActiveServiceWorker(registration)).resolves.toBe(registration)
    expect(addEventListener).not.toHaveBeenCalled()
  })

  it.each(['installing', 'waiting'] as const)(
    'waits for a %s replacement to activate and removes the listener',
    async (phase) => {
      const replacement = makeWorker()
      const removeEventListener = vi.spyOn(replacement.worker, 'removeEventListener')
      const registration = makeRegistration({
        active: makeWorker().worker,
        installing: phase === 'installing' ? replacement.worker : null,
        waiting: phase === 'waiting' ? replacement.worker : null,
      })
      const ready = waitForActiveServiceWorker(registration)
      replacement.setState('installed')
      expect(removeEventListener).not.toHaveBeenCalled()

      replacement.setState('activated')

      await expect(ready).resolves.toBe(registration)
      expect(removeEventListener).toHaveBeenCalledWith('statechange', expect.any(Function))
    },
  )

  it('removes the listener when a replacement becomes redundant', async () => {
    const replacement = makeWorker()
    const removeEventListener = vi.spyOn(replacement.worker, 'removeEventListener')
    const registration = makeRegistration({ installing: replacement.worker })
    const ready = waitForActiveServiceWorker(registration)
    replacement.setState('redundant')

    await expect(ready).rejects.toThrow('became redundant')
    expect(removeEventListener).toHaveBeenCalledWith('statechange', expect.any(Function))
  })

  it('times out an installing replacement and removes the listener', async () => {
    vi.useFakeTimers()
    const clearTimeout = vi.spyOn(globalThis, 'clearTimeout')
    const replacement = makeWorker()
    const removeEventListener = vi.spyOn(replacement.worker, 'removeEventListener')
    const registration = makeRegistration({ installing: replacement.worker })
    const ready = waitForActiveServiceWorker(registration, { timeoutMs: 5000 })
    const rejection = ready.catch((error: unknown) => error)

    await vi.advanceTimersByTimeAsync(5000)

    const error = await rejection
    expect(error).toBeInstanceOf(ServiceWorkerActivationTimeoutError)
    expect((error as ServiceWorkerActivationTimeoutError).name).toBe(
      'ServiceWorkerActivationTimeoutError',
    )
    expect(removeEventListener).toHaveBeenCalledWith('statechange', expect.any(Function))
    expect(clearTimeout).toHaveBeenCalled()
  })

  it('keeps an unbounded replacement wait pending until activation', async () => {
    vi.useFakeTimers()
    const replacement = makeWorker()
    const registration = makeRegistration({ installing: replacement.worker })
    const ready = waitForActiveServiceWorker(registration)
    let settled = false
    void ready.finally(() => {
      settled = true
    })

    await vi.advanceTimersByTimeAsync(5000)
    expect(settled).toBe(false)
    replacement.setState('activated')
    await expect(ready).resolves.toBe(registration)
  })
})

function deferredContainer(ready: ServiceWorkerRegistration): ServiceWorkerContainer {
  return { ready: Promise.resolve(ready) }
}

function makeRegistration(partial: {
  active?: ServiceWorker | null
  installing?: ServiceWorker | null
  waiting?: ServiceWorker | null
}): ServiceWorkerRegistration {
  return {
    active: partial.active ?? null,
    installing: partial.installing ?? null,
    waiting: partial.waiting ?? null,
  }
}

function makeWorker(state: ServiceWorker['state'] = 'installing') {
  const worker = new EventTarget() as ServiceWorker
  Object.defineProperty(worker, 'state', { configurable: true, value: state })
  return {
    worker,
    setState(nextState: ServiceWorker['state']) {
      Object.defineProperty(worker, 'state', { configurable: true, value: nextState })
      worker.dispatchEvent(new Event('statechange'))
    },
  }
}
