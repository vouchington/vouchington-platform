import type http from 'node:http'

interface Closable {
  close: () => Promise<unknown>
}

export interface WorkerServeDeps<W extends Closable = Closable> {
  workers: readonly W[]
  /** Registers a callback run on graceful shutdown. */
  addShutdown: (callback: () => Promise<void>) => void
  onError: (error: Error) => void
  /** Flushes buffered error reports, bounded by the given milliseconds. */
  flushErrors: (timeoutMs: number) => Promise<unknown>
  createServer: typeof http.createServer
  process: Pick<NodeJS.Process, 'on' | 'env' | 'exit'>
  console: Pick<Console, 'log' | 'error'>
  setTimeout: typeof globalThis.setTimeout
}

const toError = (reason: unknown): Error =>
  reason instanceof Error ? reason : new Error(String(reason))

/**
 * Installs process-level crash reporting and graceful worker shutdown, plus an optional prewarm
 * HTTP server (only when both `NODE_PREWARM` and `NODE_PREWARM_PORT` are set).
 */
export function registerWorkerServe<W extends Closable>(deps: WorkerServeDeps<W>): readonly W[] {
  deps.process.on('uncaughtException', (error: unknown) => {
    deps.onError(toError(error))
    const exit = () => deps.process.exit(1)
    // The two-argument `.then(exit, exit)` form is deliberate: `.then(exit).catch(exit)` adds a
    // microtask tick before `exit` on rejection, and that timing is observable in this fatal path.
    // oxlint-disable-next-line promise/prefer-catch, promise/catch-or-return, promise/no-promise-in-callback
    deps.flushErrors(2000).then(exit, exit)
    deps.setTimeout(exit, 2100)
  })
  deps.process.on('unhandledRejection', (reason: unknown) => deps.onError(toError(reason)))

  const prewarmPort =
    deps.process.env.NODE_PREWARM && deps.process.env.NODE_PREWARM_PORT
      ? Number(deps.process.env.NODE_PREWARM_PORT)
      : undefined
  const prewarmServer =
    prewarmPort === undefined ? undefined : deps.createServer((_, res) => res.end())
  prewarmServer?.listen(prewarmPort)

  deps.console.log('Workers: workers loaded.')

  deps.addShutdown(async () => {
    if (prewarmServer) {
      prewarmServer.closeAllConnections()
      await new Promise<void>((resolve) => prewarmServer.close(() => resolve()))
    }
    deps.console.log('Workers: shutting down workers...')
    const results = await Promise.allSettled(deps.workers.map((worker) => worker.close()))
    for (const result of results) {
      if (result.status === 'rejected') deps.console.error(result.reason)
    }
    deps.console.log('Workers: workers closed gracefully.')
  })

  return deps.workers
}
