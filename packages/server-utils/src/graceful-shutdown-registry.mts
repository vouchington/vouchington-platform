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
   * others. Returns the failures instead of throwing.
   */
  close: (overrides?: CloseOverrides) => Promise<Error[]>
}

const toError = (reason: unknown): Error =>
  reason instanceof Error ? reason : new Error(String(reason))

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
      const errors: Error[] = []
      results.forEach((result, index) => {
        if (result.status === 'rejected') errors.push(toError(result.reason))
        else log?.(successMessage(names[index] as string))
      })
      return errors
    },
  }
}
