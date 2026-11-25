import { ProxyAgent, fetch as undiciFetch, type Dispatcher } from 'undici'
import {
  EXTERNAL_DISPATCHER_BODY_TIMEOUT_MS,
  EXTERNAL_DISPATCHER_CONNECT_TIMEOUT_MS,
  EXTERNAL_DISPATCHER_HEADERS_TIMEOUT_MS,
  EXTERNAL_DISPATCHER_KEEP_ALIVE_MAX_TIMEOUT_MS,
  EXTERNAL_DISPATCHER_KEEP_ALIVE_TIMEOUT_MS,
  LONG_RUNNING_EXTERNAL_DISPATCHER_HEADERS_TIMEOUT_MS,
  type ExternalFetch,
  type SharedDispatcherTimeouts,
} from './dispatcher-defaults.mts'

export type ProxyFetchProfile = 'routine' | 'long-running'

export interface DirectHttpDispatchers {
  getExternalFetch(): ExternalFetch
  getLongRunningExternalFetch(): ExternalFetch
  getExternalRequestDispatcher(): Dispatcher
  getLongRunningExternalRequestDispatcher(): Dispatcher
}

export interface ProxyRoutedDispatchersOptions<
  TRoute extends string = string,
> extends SharedDispatcherTimeouts {
  /** Direct transport used whenever a route is not routed through the proxy. */
  direct: DirectHttpDispatchers
  /** Lazily resolves the proxy URL the first time a proxy-enabled route runs. */
  getProxyUrl: () => string
  /** Receives failures while closing proxy dispatchers. Required: there is no global reporter. */
  onError: (error: unknown) => void
  /** Optional initial routing resolver; can be installed or replaced at runtime. */
  isProxyEnabled?: (route: TRoute) => boolean
}

export type ProxyRoutedDispatchers<TRoute extends string = string> = ReturnType<
  typeof createProxyRoutedDispatchers<TRoute>
>

/**
 * Wraps a direct dispatcher owner with lazy per-profile `ProxyAgent` pools selected at request
 * time, so runtime routing changes apply to already-created SDK clients without a restart.
 */
export function createProxyRoutedDispatchers<TRoute extends string = string>(
  options: ProxyRoutedDispatchersOptions<TRoute>,
) {
  const { direct, getProxyUrl, onError } = options
  const shared = {
    connections: options.connections ?? 5,
    bodyTimeout: options.bodyTimeoutMs ?? EXTERNAL_DISPATCHER_BODY_TIMEOUT_MS,
    keepAliveTimeout: options.keepAliveTimeoutMs ?? EXTERNAL_DISPATCHER_KEEP_ALIVE_TIMEOUT_MS,
    keepAliveMaxTimeout:
      options.keepAliveMaxTimeoutMs ?? EXTERNAL_DISPATCHER_KEEP_ALIVE_MAX_TIMEOUT_MS,
    connect: { timeout: options.connectTimeoutMs ?? EXTERNAL_DISPATCHER_CONNECT_TIMEOUT_MS },
  }
  const routineHeadersTimeout = options.headersTimeoutMs ?? EXTERNAL_DISPATCHER_HEADERS_TIMEOUT_MS
  const longRunningHeadersTimeout =
    options.longRunningHeadersTimeoutMs ?? LONG_RUNNING_EXTERNAL_DISPATCHER_HEADERS_TIMEOUT_MS

  const proxyDispatchers: Partial<Record<ProxyFetchProfile, ProxyAgent>> = {}
  let closePromise: Promise<void> | undefined
  let routingResolver = options.isProxyEnabled

  function setRoutingResolver(resolver: ((route: TRoute) => boolean) | undefined): void {
    routingResolver = resolver
  }

  function isProxyRouteEnabled(route: TRoute): boolean {
    return routingResolver?.(route) === true
  }

  function getProxyDispatcher(profile: ProxyFetchProfile = 'routine'): Dispatcher {
    const existing = proxyDispatchers[profile]
    if (existing) return existing
    const dispatcher = new ProxyAgent({
      uri: getProxyUrl(),
      ...shared,
      headersTimeout:
        profile === 'long-running' ? longRunningHeadersTimeout : routineHeadersTimeout,
    })
    proxyDispatchers[profile] = dispatcher
    return dispatcher
  }

  function getRoutedFetch(route: TRoute, profile: ProxyFetchProfile = 'routine'): ExternalFetch {
    return async (input, init) => {
      const dispatcher = isProxyRouteEnabled(route) ? getProxyDispatcher(profile) : undefined
      if (!dispatcher) {
        return profile === 'long-running'
          ? direct.getLongRunningExternalFetch()(input, init)
          : direct.getExternalFetch()(input, init)
      }
      // Undici and ambient WHATWG types are skewed versions of the same runtime objects.
      return undiciFetch(input as Parameters<typeof undiciFetch>[0], {
        ...(init as Parameters<typeof undiciFetch>[1]),
        dispatcher,
      }) as unknown as Promise<Response>
    }
  }

  function getRoutedRequestDispatcher(
    route: TRoute,
    profile: ProxyFetchProfile = 'routine',
  ): Dispatcher {
    return isProxyRouteEnabled(route)
      ? getProxyDispatcher(profile)
      : profile === 'long-running'
        ? direct.getLongRunningExternalRequestDispatcher()
        : direct.getExternalRequestDispatcher()
  }

  /** Idempotent: closes only proxy agents owned by this instance, leaving `direct` untouched. */
  function closeProxyDispatchers(): Promise<void> {
    closePromise ??= Promise.all(
      Object.values(proxyDispatchers).map((dispatcher) => dispatcher.close().catch(onError)),
    ).then(() => undefined)
    return closePromise
  }

  return {
    setRoutingResolver,
    isProxyRouteEnabled,
    getRoutedFetch,
    getRoutedRequestDispatcher,
    closeProxyDispatchers,
    [Symbol.asyncDispose]: closeProxyDispatchers,
  }
}
