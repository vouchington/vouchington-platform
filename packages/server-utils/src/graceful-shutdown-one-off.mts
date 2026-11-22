import type { GracefulShutdownProcess } from './graceful-shutdown-run.mts'

export interface OneOffShutdownOptions {
  gracePeriodMs: number
  /** Closes resources and returns the failures, as `ShutdownRegistry.close` does. */
  close: () => Promise<Error[]>
  logError?: (...args: unknown[]) => void
  /** Defaults to the global `process`. */
  process?: Pick<GracefulShutdownProcess, 'exit'>
}

/**
 * Closes resources for a short-lived command. A timer force-exits with code 1 if the close never
 * settles; once it settles the timer is unref'd, so only a leaked handle can still trigger it.
 * Throws an `AggregateError` when any close failed.
 */
export async function shutdownForOneOffCommand(options: OneOffShutdownOptions): Promise<void> {
  const proc = options.process ?? process
  const forceExitTimer = setTimeout(() => {
    options.logError?.('One-off shutdown: process did not terminate in time, forcing exit...')
    proc.exit(1)
  }, options.gracePeriodMs)

  try {
    const errors = await options.close()
    if (errors.length > 0) throw new AggregateError(errors, 'One-off shutdown failed')
  } finally {
    forceExitTimer.unref()
  }
}
