import { Agent, fetch as undiciFetch, type Dispatcher } from 'undici'
import { createPinnedDispatcherCache, type ResolvedSafeAddress } from 'ssrf-guard/node'

export const EXTERNAL_DISPATCHER_HEADERS_TIMEOUT_MS = 60_000
export const LONG_RUNNING_EXTERNAL_DISPATCHER_HEADERS_TIMEOUT_MS = 300_000
// A maximum gap between body chunks, not a deadline. Keep it generous so sparse streams survive.
export const EXTERNAL_DISPATCHER_BODY_TIMEOUT_MS = 300_000
export const EXTERNAL_DISPATCHER_KEEP_ALIVE_TIMEOUT_MS = 4_000
export const EXTERNAL_DISPATCHER_KEEP_ALIVE_MAX_TIMEOUT_MS = 600_000
export const EXTERNAL_DISPATCHER_CONNECT_TIMEOUT_MS = 10_000

export type ExternalFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface HttpDispatchersOptions {
  /** Receives failures while closing dispatchers. Required: there is no global reporter. */
  onError: (error: unknown) => void
  /**
   * Called on each dispatcher lookup. A non-empty result composes the interceptors onto the
   * shared dispatcher (cached per base dispatcher on first use); an empty result leaves it raw.
   * Pinned dispatchers are never composed.
   */
  interceptors?: () => Dispatcher.DispatcherComposeInterceptor[]
  headersTimeoutMs?: number
  longRunningHeadersTimeoutMs?: number
  bodyTimeoutMs?: number
  keepAliveTimeoutMs?: number
  keepAliveMaxTimeoutMs?: number
  connectTimeoutMs?: number
  connections?: number
  pinnedCacheSize?: number
}

export type HttpDispatchers = ReturnType<typeof createHttpDispatchers>

export function createHttpDispatchers(options: HttpDispatchersOptions) {
  const { onError } = options
  const shared = {
    connections: options.connections ?? 5,
    bodyTimeout: options.bodyTimeoutMs ?? EXTERNAL_DISPATCHER_BODY_TIMEOUT_MS,
    keepAliveTimeout: options.keepAliveTimeoutMs ?? EXTERNAL_DISPATCHER_KEEP_ALIVE_TIMEOUT_MS,
    keepAliveMaxTimeout:
      options.keepAliveMaxTimeoutMs ?? EXTERNAL_DISPATCHER_KEEP_ALIVE_MAX_TIMEOUT_MS,
    connect: { timeout: options.connectTimeoutMs ?? EXTERNAL_DISPATCHER_CONNECT_TIMEOUT_MS },
  }
  const headersTimeout = options.headersTimeoutMs ?? EXTERNAL_DISPATCHER_HEADERS_TIMEOUT_MS
  const externalRequestDispatcher = new Agent({ ...shared, headersTimeout })
  const longRunningExternalRequestDispatcher = new Agent({
    ...shared,
    headersTimeout:
      options.longRunningHeadersTimeoutMs ?? LONG_RUNNING_EXTERNAL_DISPATCHER_HEADERS_TIMEOUT_MS,
  })
  const pinnedDispatcherCache = createPinnedDispatcherCache({
    ...shared,
    headersTimeout,
    maxSize: options.pinnedCacheSize ?? 100,
  })
  const guardedDispatcherCache = new WeakMap<Dispatcher, Dispatcher>()
  let closePromise: Promise<void> | null = null

  function getGuardedDispatcher(dispatcher: Dispatcher): Dispatcher {
    const interceptors = options.interceptors?.()
    if (!interceptors?.length) return dispatcher
    const cached = guardedDispatcherCache.get(dispatcher)
    if (cached) return cached
    const guarded = dispatcher.compose(interceptors)
    guardedDispatcherCache.set(dispatcher, guarded)
    return guarded
  }

  const getExternalRequestDispatcher = (): Dispatcher =>
    getGuardedDispatcher(externalRequestDispatcher)
  const getLongRunningExternalRequestDispatcher = (): Dispatcher =>
    getGuardedDispatcher(longRunningExternalRequestDispatcher)

  // A caller-supplied dispatcher is composed too, so SDK-level overrides cannot skip interceptors.
  function createExternalFetch(getDispatcher: () => Dispatcher): ExternalFetch {
    return (input, init) => {
      const undiciInit = init as Parameters<typeof undiciFetch>[1]
      const dispatcher = undiciInit?.dispatcher
        ? getGuardedDispatcher(undiciInit.dispatcher)
        : getDispatcher()
      // Undici and ambient WHATWG types are skewed versions of the same runtime objects.
      return undiciFetch(input as Parameters<typeof undiciFetch>[0], {
        ...undiciInit,
        dispatcher,
      }) as unknown as Promise<Response>
    }
  }

  const externalFetch = createExternalFetch(getExternalRequestDispatcher)
  const longRunningExternalFetch = createExternalFetch(getLongRunningExternalRequestDispatcher)

  /** Idempotent: every call returns the same promise. The pinned cache is terminal afterwards. */
  function closeHttpDispatchers(): Promise<void> {
    closePromise ??= Promise.all([
      externalRequestDispatcher.close().catch(onError),
      longRunningExternalRequestDispatcher.close().catch(onError),
      pinnedDispatcherCache.close(),
    ]).then(() => undefined)
    return closePromise
  }

  return {
    getExternalRequestDispatcher,
    getLongRunningExternalRequestDispatcher,
    getPinnedRequestDispatcher: (addresses: ResolvedSafeAddress[]): Dispatcher =>
      pinnedDispatcherCache.get(addresses),
    getExternalFetch: (): ExternalFetch => externalFetch,
    getLongRunningExternalFetch: (): ExternalFetch => longRunningExternalFetch,
    closeHttpDispatchers,
    [Symbol.asyncDispose]: closeHttpDispatchers,
  }
}
