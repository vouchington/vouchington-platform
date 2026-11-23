import { ShutdownError, resourcesOf, type ShutdownPhase } from './graceful-shutdown-error.mts'

export interface GracefulShutdownProcess {
  on: (signal: NodeJS.Signals, listener: () => void) => unknown
  exit: (code?: number) => unknown
}

export interface GracefulShutdownOptions {
  /** Grace period before the force-exit fallback fires. */
  gracePeriodMs: number
  /**
   * Receives each failure as a `ShutdownError` (`phase`, `signal`, and the original `cause`); one
   * failing step never skips the others.
   */
  onError: (error: ShutdownError) => void
  /** Final phase after callbacks and drain callbacks, e.g. closing shared connections. */
  closeResources?: () => Promise<unknown>
  /** Runs after `closeResources`, e.g. flushing buffered error reports. */
  flush?: () => Promise<unknown>
  log?: (...args: unknown[]) => void
  /**
   * Called with a fixed message and a context object when shutdown finished with failures
   * (`errorCount`, `signal`, `phases`, `resources`) or when the force-exit fallback fires (`phase`
   * still running, or `'completed'` after failures, plus `signal`, `gracePeriodMs`, `exitCode`).
   */
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
  const failures: ShutdownError[] = []
  const proc = options.process ?? process
  let shuttingDown = false
  let phase: ShutdownPhase | 'completed' = 'callbacks'
  let signalName = ''

  const report = (failedPhase: ShutdownPhase, cause: unknown) => {
    const error = new ShutdownError(`Graceful Shutdown: ${failedPhase} failed`, {
      cause,
      phase: failedPhase,
      signal: signalName,
    })
    failures.push(error)
    options.onError(error)
  }

  const runAll = (failedPhase: ShutdownPhase, list: readonly (() => Promise<void>)[]) =>
    Promise.all(
      list.map((callback) =>
        // The then-wrapper routes a synchronous throw from `callback` into the catch handler.
        // oxlint-disable-next-line promise/no-callback-in-promise
        Promise.resolve()
          .then(callback)
          .catch((error: unknown) => report(failedPhase, error)),
      ),
    )

  async function attempt(
    step: ShutdownPhase,
    run: (() => Promise<unknown>) | undefined,
  ): Promise<boolean> {
    phase = step
    try {
      await run?.()
      return true
    } catch (error) {
      report(step, error)
      return false
    }
  }

  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return
    shuttingDown = true
    signalName = signal
    options.log?.(`Graceful Shutdown: received ${signal} signal, shutting down...`)

    let succeeded = false
    // Fallback for handles that keep the loop alive after cleanup. Unref'd so a natural exit
    // wins; exit code 0 when shutdown succeeded, 1 when the grace period ran out.
    if (options.forceExit !== false) {
      setTimeout(() => {
        const exitCode = succeeded ? 0 : 1
        if (!succeeded) {
          options.logError?.('Graceful Shutdown: could not close in time, forcing exit...', {
            phase,
            signal,
            gracePeriodMs: options.gracePeriodMs,
            exitCode,
          })
        }
        proc.exit(exitCode)
      }, options.gracePeriodMs).unref()
    }

    await runAll('callbacks', callbacks)
    options.log?.('Graceful Shutdown: all callbacks completed.')
    phase = 'drain'
    await runAll('drain', drainCallbacks)
    options.log?.('Graceful Shutdown: drain phase completed.')
    // A failing close is reported and must not skip the final flush.
    const closed = await attempt('closeResources', options.closeResources)
    const flushed = await attempt('flush', options.flush)
    phase = 'completed'
    if (failures.length > 0) {
      options.logError?.('Graceful Shutdown: finished with failures.', {
        errorCount: failures.length,
        signal,
        phases: [...new Set(failures.map((failure) => failure.phase))],
        resources: [...new Set(failures.flatMap(resourcesOf))],
      })
    }
    if (!closed || !flushed) return
    options.log?.('Graceful Shutdown: all connections closed.')
    succeeded = true
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
