export interface GracefulShutdownProcess {
  on: (signal: NodeJS.Signals, listener: () => void) => unknown
  exit: (code?: number) => unknown
}

export interface GracefulShutdownOptions {
  /** Grace period before the force-exit fallback fires. */
  gracePeriodMs: number
  /** Receives callback failures; one failing callback never skips the others. */
  onError: (error: Error) => void
  /** Final phase after callbacks and drain callbacks, e.g. closing shared connections. */
  closeResources?: () => Promise<unknown>
  /** Runs after `closeResources`, e.g. flushing buffered error reports. */
  flush?: () => Promise<unknown>
  log?: (...args: unknown[]) => void
  /** Called with the failure text when the fallback fires before shutdown finished. */
  logError?: (...args: unknown[]) => void
  /** Defaults to the global `process`. */
  process?: GracefulShutdownProcess
  /** Set false (for example under test) to skip the force-exit timer. Defaults to true. */
  forceExit?: boolean
}

export interface GracefulShutdown {
  /** Registers a callback for the first phase; returns the callback count. */
  addCallback: (callback: () => Promise<void>) => number
  /** Registers a callback for the second phase, after every first-phase callback settled. */
  addDrainCallback: (callback: () => Promise<void>) => number
  /** Runs once: callbacks, drain callbacks, `closeResources`, then `flush`. Later calls no-op. */
  shutdown: (signal: string) => Promise<void>
  /** Installs `shutdown` as the listener for each signal (default SIGTERM and SIGINT). */
  installSignalHandlers: (signals?: readonly NodeJS.Signals[]) => void
}

export function createGracefulShutdown(options: GracefulShutdownOptions): GracefulShutdown {
  const callbacks: (() => Promise<void>)[] = []
  const drainCallbacks: (() => Promise<void>)[] = []
  const proc = options.process ?? process
  let shuttingDown = false

  const runAll = (list: readonly (() => Promise<void>)[]) =>
    Promise.all(
      list.map((callback) =>
        // The then-wrapper routes a synchronous throw from `callback` into the catch handler.
        // oxlint-disable-next-line promise/no-callback-in-promise
        Promise.resolve()
          .then(callback)
          .catch((error: unknown) => {
            options.onError(error instanceof Error ? error : new Error(String(error)))
          }),
      ),
    )

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true
    options.log?.(`Graceful Shutdown: received ${signal} signal, shutting down...`)

    let succeeded = false
    // Fallback for handles that keep the loop alive after cleanup. Unref'd so a natural exit
    // wins; exit code 0 when shutdown succeeded, 1 when the grace period ran out.
    if (options.forceExit !== false) {
      setTimeout(() => {
        if (!succeeded)
          options.logError?.('Graceful Shutdown: could not close in time, forcing exit...')
        proc.exit(succeeded ? 0 : 1)
      }, options.gracePeriodMs).unref()
    }

    await runAll(callbacks)
    options.log?.('Graceful Shutdown: all callbacks completed.')
    await runAll(drainCallbacks)
    options.log?.('Graceful Shutdown: drain phase completed.')
    // A failing close is reported and must not skip the final flush.
    const closed = await attempt(options.closeResources)
    const flushed = await attempt(options.flush)
    if (!closed || !flushed) return
    options.log?.('Graceful Shutdown: all connections closed.')
    succeeded = true
  }

  async function attempt(step: (() => Promise<unknown>) | undefined): Promise<boolean> {
    try {
      await step?.()
      return true
    } catch (error) {
      options.onError(error instanceof Error ? error : new Error(String(error)))
      return false
    }
  }

  return {
    addCallback: (callback) => callbacks.push(callback),
    addDrainCallback: (callback) => drainCallbacks.push(callback),
    shutdown,
    installSignalHandlers(signals = ['SIGTERM', 'SIGINT']) {
      // `shutdown` reports its own step failures through `onError`, so it does not reject.
      for (const signal of signals) proc.on(signal, () => void shutdown(signal))
    },
  }
}
