import { describe, expect, it, vi } from 'vitest'

import { registerWorkerServe, type WorkerServeDeps } from './serve.mts'

function setup(overrides: Partial<WorkerServeDeps> = {}, env: NodeJS.ProcessEnv = {}) {
  const handlers = new Map<string, (arg: unknown) => void>()
  const shutdown: Array<() => Promise<void>> = []
  const server = {
    listen: vi.fn(),
    closeAllConnections: vi.fn(),
    close: vi.fn((callback: () => void) => callback()),
  }
  const deps = {
    workers: [{ close: vi.fn(async () => undefined) }, { close: vi.fn(async () => undefined) }],
    addShutdown: vi.fn((callback: () => Promise<void>) => shutdown.push(callback)),
    onError: vi.fn(),
    flushErrors: vi.fn(async () => undefined),
    createServer: vi.fn(() => server),
    process: {
      on: vi.fn((event: string, handler: (arg: unknown) => void) => handlers.set(event, handler)),
      env,
      exit: vi.fn(),
    },
    console: { log: vi.fn(), error: vi.fn() },
    setTimeout: vi.fn(),
    ...overrides,
  } as unknown as WorkerServeDeps
  return { deps, handlers, shutdown, server }
}

describe('registerWorkerServe', () => {
  it('returns the workers and logs that they loaded', () => {
    const { deps } = setup()

    expect(registerWorkerServe(deps)).toBe(deps.workers)
    expect(deps.console.log).toHaveBeenCalledWith('Workers: workers loaded.')
  })

  it('reports an uncaught exception, then exits 1 after the flush', async () => {
    const { deps, handlers } = setup()

    registerWorkerServe(deps)
    handlers.get('uncaughtException')!(new Error('boom'))
    await Promise.resolve()
    await Promise.resolve()

    expect(deps.onError).toHaveBeenCalledWith(new Error('boom'))
    expect(deps.flushErrors).toHaveBeenCalledWith(2000)
    expect(deps.process.exit).toHaveBeenCalledWith(1)
    expect(deps.setTimeout).toHaveBeenCalledWith(expect.any(Function), 2100)
  })

  it('exits 1 within two microtasks when the flush rejects, and wraps non-Errors', async () => {
    const { deps, handlers } = setup({
      flushErrors: vi.fn(() => Promise.reject(new Error('flush'))),
    })

    registerWorkerServe(deps)
    handlers.get('uncaughtException')!('string failure')
    await Promise.resolve()
    await Promise.resolve()

    expect(deps.onError).toHaveBeenCalledWith(new Error('string failure'))
    expect(deps.process.exit).toHaveBeenCalledTimes(1)
  })

  it('exits from the fallback timer', () => {
    const { deps, handlers } = setup({ flushErrors: vi.fn(() => new Promise(() => undefined)) })
    registerWorkerServe(deps)
    handlers.get('uncaughtException')!(new Error('boom'))

    const timer = vi.mocked(deps.setTimeout).mock.calls[0]![0] as () => void
    timer()

    expect(deps.process.exit).toHaveBeenCalledWith(1)
  })

  it('reports unhandled rejections without exiting', () => {
    const { deps, handlers } = setup()
    registerWorkerServe(deps)

    handlers.get('unhandledRejection')!(new Error('rejected'))
    handlers.get('unhandledRejection')!('text')

    expect(deps.onError).toHaveBeenNthCalledWith(1, new Error('rejected'))
    expect(deps.onError).toHaveBeenNthCalledWith(2, new Error('text'))
    expect(deps.process.exit).not.toHaveBeenCalled()
  })

  it('creates the prewarm server only when both env vars are set', () => {
    for (const env of [{}, { NODE_PREWARM: '1' }, { NODE_PREWARM_PORT: '9' }]) {
      const { deps } = setup({}, env)
      registerWorkerServe(deps)
      expect(deps.createServer).not.toHaveBeenCalled()
    }

    const { deps, server } = setup({}, { NODE_PREWARM: '1', NODE_PREWARM_PORT: '8123' })
    registerWorkerServe(deps)
    const handler = vi.mocked(deps.createServer).mock.calls[0]![0] as (
      a: unknown,
      res: { end(): void },
    ) => void
    const res = { end: vi.fn() }
    handler({}, res)

    expect(server.listen).toHaveBeenCalledWith(8123)
    expect(res.end).toHaveBeenCalled()
  })

  it('closes the prewarm server and all workers on shutdown, logging rejected closes', async () => {
    const { deps, shutdown, server } = setup({}, { NODE_PREWARM: '1', NODE_PREWARM_PORT: '8123' })
    const failure = new Error('close failed')
    vi.mocked(deps.workers[1]!.close).mockRejectedValueOnce(failure)
    registerWorkerServe(deps)

    await shutdown[0]!()

    expect(server.closeAllConnections).toHaveBeenCalled()
    expect(server.close).toHaveBeenCalled()
    expect(deps.workers[0]!.close).toHaveBeenCalled()
    expect(deps.console.error).toHaveBeenCalledWith(failure)
    expect(deps.console.log).toHaveBeenLastCalledWith('Workers: workers closed gracefully.')
  })

  it('shuts down without a prewarm server', async () => {
    const { deps, shutdown } = setup()
    registerWorkerServe(deps)

    await shutdown[0]!()

    expect(deps.console.error).not.toHaveBeenCalled()
    expect(deps.workers[0]!.close).toHaveBeenCalled()
  })
})
