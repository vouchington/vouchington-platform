import { ShutdownError } from './graceful-shutdown-error.mts'

export type ResourceShutdown = () => Promise<void>

export interface ShutdownRegistryOptions {
  /** Receives one success line per resource that closed. */
  log?: (...args: unknown[]) => void
  /** Builds the success line for a resource name. */
  successMessage?: (name: string) => string
}

export interface CloseOverrides {
  /** Per-call replacements keyed by resource name; registered owners are left unchanged. */
  shutdowns?: Readonly<Record<string, ResourceShutdown>>
  /** Replaces the registry logger for this call. */
  log?: (...args: unknown[]) => void
}

export interface ShutdownRegistry {
  /** Registers the shutdown for `name`; the latest registration wins. */
  register: (name: string, shutdown: ResourceShutdown) => void
  /**
   * Runs every registered shutdown (plus overrides) concurrently, so one failure never skips the
   * others. Returns the failures instead of throwing, each a `ShutdownError` whose `resource` is
   * the registered name and whose `cause` is the original thrown value.
   */
  close: (overrides?: CloseOverrides) => Promise<ShutdownError[]>
}

/**
 * A late-binding registry for resources (connections, pools) whose owners register a shutdown at
 * module load, so the shutdown coordinator needs no import of them and creates no dependency cycle.
 */
export function createShutdownRegistry(options: ShutdownRegistryOptions = {}): ShutdownRegistry {
  const registered = new Map<string, ResourceShutdown>()
  const successMessage =
    options.successMessage ?? ((name: string) => `Graceful Shutdown: ${name} closed.`)

  return {
    register(name, shutdown) {
      registered.set(name, shutdown)
    },
    async close(overrides = {}) {
      const log = overrides.log ?? options.log
      const shutdowns = new Map([...registered, ...Object.entries(overrides.shutdowns ?? {})])
      const names = [...shutdowns.keys()]
      // Promise.resolve().then also turns a synchronous throw into a rejection.
      const results = await Promise.allSettled(
        names.map((name) => Promise.resolve().then(shutdowns.get(name))),
      )
      const errors: ShutdownError[] = []
      results.forEach((result, index) => {
        const name = names[index] as string
        if (result.status === 'rejected') {
          errors.push(
            new ShutdownError('Graceful Shutdown: resource failed to close', {
              cause: result.reason,
              resource: name,
            }),
          )
        } else log?.(successMessage(name))
      })
      return errors
    },
  }
}
