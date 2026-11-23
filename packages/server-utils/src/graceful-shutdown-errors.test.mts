import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  ShutdownError,
  createGracefulShutdown,
  createShutdownRegistry,
  shutdownForOneOffCommand,
  type GracefulShutdownOptions,
  type GracefulShutdownProcess,
} from './graceful-shutdown.mts'

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

const exitingProcess = () => {
  const exit = vi.fn<(code?: number) => unknown>()
  const proc: GracefulShutdownProcess = { on: vi.fn(), exit }
  return Object.assign(proc, { exit })
}

function setup(options: Partial<GracefulShutdownOptions> = {}) {
  const onError = vi.fn<(error: ShutdownError) => void>()
  const logError = vi.fn<(...args: unknown[]) => void>()
  const proc = exitingProcess()
  const shutdown = createGracefulShutdown({
    gracePeriodMs: 250,
    onError,
    logError,
    process: proc,
    ...options,
  })
  return { shutdown, onError, logError, proc }
}

describe('ShutdownError', () => {
  it('omits attributes that were not provided', () => {
    const error = new ShutdownError('failed', { cause: 'x' })
    expect(error).toMatchObject({ name: 'ShutdownError', message: 'failed', cause: 'x' })
    expect(Object.keys(error)).not.toContain('phase')
  })

  it('carries every provided attribute', () => {
    const error = new ShutdownError('failed', {
      cause: 'x',
      resource: 'db',
      phase: 'flush',
      signal: 'SIGINT',
    })
    expect(error).toMatchObject({ resource: 'db', phase: 'flush', signal: 'SIGINT' })
  })
})

describe('createShutdownRegistry errors', () => {
  it('names the failed resource and keeps the original error as cause', async () => {
    const original = new Error('connection reset')
    const registry = createShutdownRegistry()
    registry.register('PostgreSQL', () => Promise.reject(original))

    const [error] = await registry.close()

    expect(error).toBeInstanceOf(ShutdownError)
    expect(error).toMatchObject({
      resource: 'PostgreSQL',
      message: 'Graceful Shutdown: resource failed to close',
    })
    expect(error?.cause).toBe(original)
  })

  it('keeps a non-Error throw as the cause', async () => {
    const registry = createShutdownRegistry()
    registry.register('cache', () => {
      throw 'plain string'
    })
    const [error] = await registry.close()
    expect(error?.cause).toBe('plain string')
  })
})

describe('createGracefulShutdown errors', () => {
  it('reports a callbacks failure with its phase, signal, and cause', async () => {
    const { shutdown, onError } = setup()
    const failure = new Error('callback failed')
    shutdown.addCallback(() => Promise.reject(failure))
    await shutdown.shutdown('SIGTERM')
    const error = onError.mock.calls[0]?.[0]
    expect(error).toMatchObject({ phase: 'callbacks', signal: 'SIGTERM' })
    expect(error?.cause).toBe(failure)
  })

  it('reports a drain failure with its phase', async () => {
    const { shutdown, onError } = setup()
    shutdown.addDrainCallback(() => Promise.reject(new Error('drain failed')))
    await shutdown.shutdown('SIGINT')
    expect(onError.mock.calls[0]?.[0]).toMatchObject({ phase: 'drain', signal: 'SIGINT' })
  })

  it('reports closeResources and flush failures with their phases', async () => {
    const { shutdown, onError } = setup({
      closeResources: () => Promise.reject(new Error('close failed')),
      flush: () => Promise.reject(new Error('flush failed')),
    })
    await shutdown.shutdown('SIGTERM')
    expect(onError.mock.calls.map(([error]) => error.phase)).toEqual(['closeResources', 'flush'])
  })

  it('wraps a non-Error throw with the original value as cause', async () => {
    const { shutdown, onError } = setup()
    shutdown.addCallback(() => {
      throw 'sync failure'
    })
    await shutdown.shutdown('SIGTERM')
    expect(onError.mock.calls[0]?.[0].cause).toBe('sync failure')
  })

  it('logs the still-running phase, signal, grace period, and exit code on force-exit', async () => {
    const { shutdown, logError, proc } = setup()
    const never = Promise.withResolvers<void>()
    shutdown.addDrainCallback(() => never.promise)
    const pending = shutdown.shutdown('SIGTERM')
    await vi.advanceTimersByTimeAsync(250)
    expect(logError).toHaveBeenCalledExactlyOnceWith(
      'Graceful Shutdown: could not close in time, forcing exit...',
      { phase: 'drain', signal: 'SIGTERM', gracePeriodMs: 250, exitCode: 1 },
    )
    expect(proc.exit).toHaveBeenCalledWith(1)
    never.resolve()
    await pending
  })

  it('reports the closeResources phase when it is the one still running', async () => {
    const never = Promise.withResolvers<void>()
    const { shutdown, logError } = setup({ closeResources: () => never.promise })
    const pending = shutdown.shutdown('SIGTERM')
    await vi.advanceTimersByTimeAsync(250)
    expect(logError.mock.calls[0]?.[1]).toMatchObject({ phase: 'closeResources' })
    never.resolve()
    await pending
  })

  it('logs completed as the phase when the timer fires after a failed shutdown', async () => {
    const { shutdown, logError } = setup({ closeResources: () => Promise.reject(new Error('x')) })
    await shutdown.shutdown('SIGTERM')
    logError.mockClear()
    await vi.advanceTimersByTimeAsync(250)
    expect(logError.mock.calls[0]?.[1]).toMatchObject({ phase: 'completed', exitCode: 1 })
  })

  it('logs one summary with the error count, phases, and resource names', async () => {
    const registry = createShutdownRegistry()
    registry.register('PostgreSQL', () => Promise.reject(new Error('a')))
    registry.register('Valkey', () => Promise.reject(new Error('b')))
    const { shutdown, logError } = setup({
      forceExit: false,
      closeResources: async () => {
        throw new AggregateError(await registry.close())
      },
    })
    shutdown.addCallback(() => Promise.reject(new Error('c')))
    await shutdown.shutdown('SIGTERM')
    expect(logError).toHaveBeenCalledExactlyOnceWith('Graceful Shutdown: finished with failures.', {
      errorCount: 2,
      signal: 'SIGTERM',
      phases: ['callbacks', 'closeResources'],
      resources: ['PostgreSQL', 'Valkey'],
    })
  })

  it('does not log a summary when nothing failed', async () => {
    const { shutdown, logError } = setup({ forceExit: false })
    await shutdown.shutdown('SIGTERM')
    expect(logError).not.toHaveBeenCalled()
  })

  it('does not require a logError injection to summarize failures', async () => {
    const shutdown = createGracefulShutdown({
      gracePeriodMs: 250,
      onError: () => {},
      forceExit: false,
    })
    shutdown.addCallback(() => Promise.reject(new Error('c')))
    await expect(shutdown.shutdown('SIGTERM')).resolves.toBeUndefined()
  })
})

describe('shutdownForOneOffCommand errors', () => {
  it('lists failed resources in the message and keeps resource on each inner error', async () => {
    const registry = createShutdownRegistry()
    registry.register('PostgreSQL', () => Promise.reject(new Error('a')))
    registry.register('Valkey', () => Promise.reject(new Error('b')))
    const err = await shutdownForOneOffCommand({
      gracePeriodMs: 100,
      close: () => registry.close(),
      process: exitingProcess(),
    }).catch((error: unknown) => error)
    expect(err).toBeInstanceOf(AggregateError)
    expect((err as AggregateError).message).toBe('One-off shutdown failed: PostgreSQL, Valkey')
    expect((err as AggregateError).errors.map((e: ShutdownError) => e.resource)).toEqual([
      'PostgreSQL',
      'Valkey',
    ])
  })
})
