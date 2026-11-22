import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createGracefulShutdown,
  createShutdownRegistry,
  shutdownForOneOffCommand,
  type GracefulShutdownProcess,
} from './graceful-shutdown.mts'

function fakeProcess() {
  const listeners = new Map<string, () => void>()
  const exit = vi.fn<(code?: number) => unknown>()
  const proc: GracefulShutdownProcess = {
    on: (signal, listener) => listeners.set(signal, listener),
    exit,
  }
  return { proc, listeners, exit }
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('createShutdownRegistry', () => {
  it('closes registered resources, logs successes, and uses the latest registration', async () => {
    const calls: string[] = []
    const log = vi.fn<(...args: unknown[]) => void>()
    const registry = createShutdownRegistry({ log })
    registry.register('cache', async () => void calls.push('old'))
    registry.register('cache', async () => void calls.push('cache'))
    registry.register('db', async () => void calls.push('db'))

    await expect(registry.close()).resolves.toEqual([])

    expect(calls).toEqual(['cache', 'db'])
    expect(log.mock.calls).toEqual([
      ['Graceful Shutdown: cache closed.'],
      ['Graceful Shutdown: db closed.'],
    ])
  })

  it('closes nothing and logs nothing for an empty registry without a logger', async () => {
    await expect(createShutdownRegistry().close()).resolves.toEqual([])
  })

  it('collects failures, normalizes non-errors, and still closes the rest', async () => {
    const log = vi.fn<(...args: unknown[]) => void>()
    const failure = new Error('db down')
    const registry = createShutdownRegistry({ log, successMessage: (name) => `closed ${name}` })
    registry.register('db', () => Promise.reject(failure))
    registry.register('sync', () => {
      throw 'plain string'
    })
    registry.register('cache', async () => {})

    const errors = await registry.close()

    expect(errors).toHaveLength(2)
    expect(errors[0]).toBe(failure)
    expect(errors[1]).toEqual(new Error('plain string'))
    expect(log.mock.calls).toEqual([['closed cache']])
  })

  it('prefers per-call overrides and a per-call logger without changing owners', async () => {
    const calls: string[] = []
    const registryLog = vi.fn<(...args: unknown[]) => void>()
    const callLog = vi.fn<(...args: unknown[]) => void>()
    const registry = createShutdownRegistry({ log: registryLog })
    registry.register('db', async () => void calls.push('registered'))

    await registry.close({
      shutdowns: { db: async () => void calls.push('override'), extra: async () => {} },
      log: callLog,
    })
    await registry.close()

    expect(calls).toEqual(['override', 'registered'])
    expect(callLog).toHaveBeenCalledTimes(2)
    expect(registryLog).toHaveBeenCalledOnce()
  })
})

describe('createGracefulShutdown', () => {
  it('runs callbacks, then drain callbacks, then resources, then flush, once', async () => {
    const order: string[] = []
    const { proc, exit } = fakeProcess()
    const log = vi.fn<(...args: unknown[]) => void>()
    const shutdown = createGracefulShutdown({
      gracePeriodMs: 1_000,
      onError: () => {},
      closeResources: async () => void order.push('resources'),
      flush: async () => void order.push('flush'),
      log,
      process: proc,
    })
    expect(shutdown.addCallback(async () => void order.push('a'))).toBe(1)
    expect(shutdown.addCallback(async () => void order.push('b'))).toBe(2)
    expect(shutdown.addDrainCallback(async () => void order.push('drain'))).toBe(1)

    await shutdown.shutdown('SIGTERM')
    await shutdown.shutdown('SIGTERM')

    expect(order).toEqual(['a', 'b', 'drain', 'resources', 'flush'])
    expect(log).toHaveBeenCalledWith('Graceful Shutdown: received SIGTERM signal, shutting down...')
    expect(log).toHaveBeenCalledWith('Graceful Shutdown: all connections closed.')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(exit).toHaveBeenCalledExactlyOnceWith(0)
  })

  it('reports callback failures through onError and keeps going', async () => {
    const { proc } = fakeProcess()
    const onError = vi.fn<(error: Error) => void>()
    const shutdown = createGracefulShutdown({ gracePeriodMs: 1_000, onError, process: proc })
    const failure = new Error('callback failed')
    shutdown.addCallback(() => Promise.reject(failure))
    shutdown.addCallback(() => {
      throw 'sync failure'
    })
    const drained = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    shutdown.addDrainCallback(drained)

    await shutdown.shutdown('SIGINT')

    expect(onError.mock.calls).toHaveLength(2)
    expect(onError).toHaveBeenCalledWith(failure)
    expect(onError).toHaveBeenCalledWith(new Error('sync failure'))
    expect(drained).toHaveBeenCalledOnce()
  })

  it('force-exits with code 1 and logs when shutdown outlives the grace period', async () => {
    const { proc, exit } = fakeProcess()
    const logError = vi.fn<(...args: unknown[]) => void>()
    const never = Promise.withResolvers<void>()
    const shutdown = createGracefulShutdown({
      gracePeriodMs: 500,
      onError: () => {},
      logError,
      process: proc,
    })
    shutdown.addCallback(() => never.promise)

    const pending = shutdown.shutdown('SIGTERM')
    await vi.advanceTimersByTimeAsync(500)

    expect(logError).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
    never.resolve()
    await pending
  })

  it('exits without a logger and skips the timer when forceExit is false', async () => {
    const forced = fakeProcess()
    const stuck = Promise.withResolvers<void>()
    const withTimer = createGracefulShutdown({
      gracePeriodMs: 100,
      onError: () => {},
      process: forced.proc,
    })
    withTimer.addCallback(() => stuck.promise)
    const pending = withTimer.shutdown('SIGTERM')
    await vi.advanceTimersByTimeAsync(100)
    expect(forced.exit).toHaveBeenCalledWith(1)
    stuck.resolve()
    await pending

    const skipped = fakeProcess()
    const noTimer = createGracefulShutdown({
      gracePeriodMs: 100,
      onError: () => {},
      forceExit: false,
      process: skipped.proc,
    })
    await noTimer.shutdown('SIGTERM')
    await vi.advanceTimersByTimeAsync(1_000)
    expect(skipped.exit).not.toHaveBeenCalled()
  })

  it('installs signal handlers that start shutdown', async () => {
    const { proc, listeners } = fakeProcess()
    const callback = vi.fn<() => Promise<void>>().mockResolvedValue(undefined)
    const shutdown = createGracefulShutdown({
      gracePeriodMs: 1_000,
      onError: () => {},
      forceExit: false,
      process: proc,
    })
    shutdown.addCallback(callback)

    shutdown.installSignalHandlers()
    expect([...listeners.keys()]).toEqual(['SIGTERM', 'SIGINT'])
    listeners.get('SIGINT')?.()
    await vi.advanceTimersByTimeAsync(0)
    expect(callback).toHaveBeenCalledOnce()

    shutdown.installSignalHandlers(['SIGHUP'])
    expect(listeners.has('SIGHUP')).toBe(true)
  })

  it('defaults to the global process for signal handlers', () => {
    const on = vi.spyOn(process, 'on').mockReturnValue(process)
    createGracefulShutdown({ gracePeriodMs: 1, onError: () => {} }).installSignalHandlers([
      'SIGHUP',
    ])
    expect(on).toHaveBeenCalledWith('SIGHUP', expect.any(Function))
    on.mockRestore()
  })
})

describe('shutdownForOneOffCommand', () => {
  it('resolves when every close succeeds and unrefs the timer', async () => {
    const { proc, exit } = fakeProcess()
    await shutdownForOneOffCommand({ gracePeriodMs: 100, close: async () => [], process: proc })
    await vi.advanceTimersByTimeAsync(100)
    expect(exit).toHaveBeenCalledWith(1)
  })

  it('throws an AggregateError carrying every failure', async () => {
    const { proc } = fakeProcess()
    const first = new Error('first')
    const second = new Error('second')
    const err = await shutdownForOneOffCommand({
      gracePeriodMs: 100,
      close: async () => [first, second],
      process: proc,
    }).catch((error: unknown) => error)
    expect(err).toBeInstanceOf(AggregateError)
    expect((err as AggregateError).errors).toEqual([first, second])
  })

  it('force-exits and logs when close never settles', async () => {
    const { proc, exit } = fakeProcess()
    const logError = vi.fn<(...args: unknown[]) => void>()
    const never = Promise.withResolvers<Error[]>()
    const pending = shutdownForOneOffCommand({
      gracePeriodMs: 100,
      close: () => never.promise,
      logError,
      process: proc,
    })
    await vi.advanceTimersByTimeAsync(100)
    expect(logError).toHaveBeenCalledOnce()
    expect(exit).toHaveBeenCalledExactlyOnceWith(1)
    never.resolve([])
    await pending
  })

  it('defaults to the global process and logger-less exit', async () => {
    const exit = vi.spyOn(process, 'exit').mockImplementation((() => undefined) as never)
    const never = Promise.withResolvers<Error[]>()
    const pending = shutdownForOneOffCommand({ gracePeriodMs: 100, close: () => never.promise })
    await vi.advanceTimersByTimeAsync(100)
    expect(exit).toHaveBeenCalledWith(1)
    never.resolve([])
    await pending
    exit.mockRestore()
  })
})
