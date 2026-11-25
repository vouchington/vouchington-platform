import type { Dispatcher } from 'undici'

export type OriginClassification = 'exempt' | 'allowed' | 'disallowed'

export interface DisallowedOriginContext {
  path?: string
  method?: string
}

export interface OriginGuardrailOptions {
  /** Returns true for internal, private, loopback, or otherwise exempt hostnames. */
  isExemptHost?: (host: string) => boolean
  /** Returns true for hostnames permitted to receive direct outbound requests. */
  isAllowedHost: (host: string) => boolean
  /** Invoked for disallowed hosts before delegating to the underlying dispatcher. */
  onDisallowedOrigin: (host: string, context: DisallowedOriginContext) => void
  /** Report each distinct disallowed host at most once per interceptor instance. Defaults to true. */
  deduplicate?: boolean
}

/**
 * Classifies an outbound origin using the injected exempt and allowlist predicates. Missing or
 * unparseable origins are treated as `'exempt'`.
 */
export function classifyOriginHost(
  origin: string | URL | undefined,
  options: Pick<OriginGuardrailOptions, 'isExemptHost' | 'isAllowedHost'>,
): OriginClassification {
  if (!origin) return 'exempt'
  const host = getHostname(origin)
  if (!host) return 'exempt'
  if (options.isExemptHost?.(host)) return 'exempt'
  if (options.isAllowedHost(host)) return 'allowed'
  return 'disallowed'
}

/**
 * Builds a non-blocking Undici compose interceptor that reports requests targeting disallowed
 * origins, stripping query strings from the path before calling `onDisallowedOrigin`.
 */
export function createOriginGuardrailInterceptor(
  options: OriginGuardrailOptions,
): Dispatcher.DispatcherComposeInterceptor {
  const deduplicate = options.deduplicate ?? true
  const reportedHosts = new Set<string>()

  return (dispatch) => (opts, handler) => {
    if (classifyOriginHost(opts.origin, options) === 'disallowed') {
      const host = getHostname(opts.origin!)!
      if (!deduplicate || !reportedHosts.has(host)) {
        if (deduplicate) reportedHosts.add(host)
        const path = stripQueryString(opts.path)
        options.onDisallowedOrigin(host, {
          ...(path === undefined ? {} : { path }),
          ...(opts.method === undefined ? {} : { method: opts.method }),
        })
      }
    }
    return dispatch(opts, handler)
  }
}

function getHostname(origin: string | URL): string | undefined {
  try {
    return (typeof origin === 'string' ? new URL(origin) : origin).hostname
  } catch {
    return undefined
  }
}

function stripQueryString(path: string | undefined): string | undefined {
  if (!path) return path
  const queryIndex = path.indexOf('?')
  return queryIndex === -1 ? path : path.slice(0, queryIndex)
}
