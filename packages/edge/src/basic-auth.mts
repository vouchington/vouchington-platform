import {
  readBasicAuthCredentialList,
  basicAuthorizationMatches,
} from './basic-auth-credentials.mts'
import { edgeErrorResponse } from './error-response.mts'

export type BasicAuthExemptMatcher = (method: string, pathname: string) => boolean

/**
 * Builds a matcher from an injected `{ path: [methods] }` table. Paths compare lowercased with one
 * trailing slash removed; methods compare uppercased. `extra` handles patterned paths.
 */
export function createBasicAuthExemptMatcher(
  methodsByPath: Readonly<Record<string, readonly string[]>>,
  extra?: BasicAuthExemptMatcher,
): BasicAuthExemptMatcher {
  const table = new Map(
    Object.entries(methodsByPath).map(([path, methods]) => [
      path.toLowerCase(),
      new Set(methods.map((method) => method.toUpperCase())),
    ]),
  )
  return (method, pathname) => {
    const trimmed = pathname.length > 1 && pathname.endsWith('/') ? pathname.slice(0, -1) : pathname
    const path = trimmed.toLowerCase()
    return table.get(path)?.has(method.toUpperCase()) === true || extra?.(method, path) === true
  }
}

export type BasicAuthGateOptions = {
  /** Comma-separated `user:password` list; unset or blank disables the gate. */
  credentials: string | undefined
  realm: string
  isExempt?: BasicAuthExemptMatcher
  /**
   * Header carrying Basic credentials when `authorization` holds a Bearer token for another
   * layer. Only honored in that Bearer-plus-secondary combination.
   */
  secondaryAuthorizationHeader?: string
  warn?: (message: string) => void
}

export type BasicAuthGate = {
  /** True when the gate is enabled and the request is not exempt. */
  appliesTo: (request: Request) => boolean
  /** A 401 challenge, or null to pass the request through. */
  check: (request: Request) => Response | null
}

/**
 * Staging-style Basic auth gate. A non-empty list with any malformed entry stays enabled and
 * rejects every request (fail closed), warning once per gate.
 */
export function createBasicAuthGate(options: BasicAuthGateOptions): BasicAuthGate {
  if (/["\\\r\n]/u.test(options.realm)) throw new Error('Invalid Basic auth realm')
  const warn = options.warn ?? console.warn
  let warned = false
  const credentials = (): ReadonlySet<string> | null => {
    const list = readBasicAuthCredentialList(options.credentials)
    if (list.status === 'absent') return null
    if (!list.hasMalformedEntries) return list.credentials
    if (!warned) {
      warned = true
      warn(
        '[Basic Auth] Rejecting malformed credential list (username and password must both be non-empty)',
      )
    }
    return new Set()
  }
  const exempt = (request: Request) =>
    options.isExempt?.(request.method, new URL(request.url).pathname) === true
  return {
    appliesTo: (request) => credentials() !== null && !exempt(request),
    check(request) {
      const allowed = credentials()
      if (!allowed || exempt(request)) return null
      const primary = request.headers.get('authorization')
      const secondary = options.secondaryAuthorizationHeader
        ? request.headers.get(options.secondaryAuthorizationHeader)
        : null
      const ordinaryBasic = primary !== null && /^Basic\s/i.test(primary) && secondary === null
      const dualBearer = primary !== null && /^Bearer\s+\S+$/i.test(primary) && secondary !== null
      const candidate = ordinaryBasic ? primary : dualBearer ? secondary : null
      if (basicAuthorizationMatches(candidate, allowed)) return null
      return edgeErrorResponse(401, 'Authentication required', 'UNAUTHORIZED', {
        'www-authenticate': `Basic realm="${options.realm}", charset="UTF-8"`,
      })
    },
  }
}
