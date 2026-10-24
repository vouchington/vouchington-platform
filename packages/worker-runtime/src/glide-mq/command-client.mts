export interface RetryContext {
  /** The client method being invoked. */
  command: string
  /** The `name` the retrying client was created with. */
  client: string
}

export interface RetryingCommandClientOptions<C extends object> {
  /** Label reported to `retry`, so shared and dedicated clients are distinguishable. */
  name: string
  /** Opens the real client. Called at most once, on the first command. */
  connect(): Promise<C>
  /** Wraps every command, for example to retry on inflight-saturation errors. */
  retry<T>(fn: () => Promise<T>, context: RetryContext): Promise<T>
  /** Value returned for `proxy.constructor`, for callers that check the client class. */
  clientConstructor?: unknown
  /**
   * Property names the proxy reports as absent instead of fabricating a command. glide-mq detects
   * cluster clients by `typeof client.clusterScan === 'function'`, so a standalone client must not
   * appear to have it. Default `['clusterScan']`.
   */
  absentProperties?: readonly string[]
}

export interface RetryingCommandClient<C extends object> {
  /** Lazily connected client whose commands all go through `retry`. */
  client: C
  /** Closes the real connection if one was opened. Safe to call more than once or before connect. */
  close(): Promise<void>
}

/**
 * Builds a lazily connected command client proxy. The real client opens on the first command,
 * every command runs through the injected `retry`, and `close()` is idempotent. Connection options,
 * timeouts, and the retry policy belong to the caller.
 */
export function createRetryingCommandClient<C extends object>(
  options: RetryingCommandClientOptions<C>,
): RetryingCommandClient<C> {
  let connected: C | null = null
  let connecting: Promise<C> | null = null
  let closing: Promise<void> | null = null
  const absent = new Set<string | symbol>(options.absentProperties ?? ['clusterScan'])

  const getRealClient = (): Promise<C> => {
    // A closed client never opens a connection, so a late command cannot leak one.
    if (closing) return Promise.reject(new Error(`Command client "${options.name}" is closed`))
    connecting ??= options.connect().then(
      (real) => {
        connected = real
        return real
      },
      (error: unknown) => {
        // Forget a failed attempt so later commands retry the connection.
        connecting = null
        throw error
      },
    )
    return connecting
  }

  const client = new Proxy({} as C, {
    get(target, property) {
      // A thenable client would be unwrapped by `await`.
      if (property === 'then' || absent.has(property)) return undefined
      if (property === 'constructor') {
        return 'clientConstructor' in options ? options.clientConstructor : target.constructor
      }
      return (...args: unknown[]) =>
        options.retry(
          () =>
            getRealClient().then((real) => {
              const value = (real as Record<string | symbol, unknown>)[property]
              return typeof value === 'function'
                ? (value as (...a: unknown[]) => unknown).apply(real, args)
                : value
            }),
          { command: String(property), client: options.name },
        )
    },
  })

  const close = (): Promise<void> => {
    closing ??= (async () => {
      const real = connected ?? (connecting ? await connecting : null)
      if (real && 'close' in real && typeof real.close === 'function') await real.close()
    })()
    return closing
  }

  return { client, close }
}
