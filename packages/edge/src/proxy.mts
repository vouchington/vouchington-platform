import { stripCookies } from './cookies.mts'
import { deleteHeaders } from './headers.mts'

const METHOD_WITHOUT_BODY = new Set(['GET', 'HEAD'])

/** Client-supplied forwarding and method-override headers an origin must never trust. */
export const CLIENT_SUPPLIED_PROXY_HEADERS_TO_STRIP = [
  'cf-connecting-ip',
  'forwarded',
  'true-client-ip',
  'via',
  'x-forwarded-for',
  'x-forwarded-port',
  'x-forwarded-prefix',
  'x-forwarded-scheme',
  'x-forwarded-server',
  'x-forwarded-ssl',
  'x-forwarded-uri',
  'x-http-method',
  'x-http-method-override',
  'x-method-override',
  'x-original-url',
  'x-real-ip',
  'x-rewrite-url',
] as const

/** Next.js internal headers that external clients must never send (middleware and cache CVEs). */
export const NEXTJS_INTERNAL_HEADERS_TO_STRIP = [
  'x-middleware-subrequest',
  'x-middleware-subrequest-id',
  'x-nextjs-data',
  'x-now-route-matches',
  'next-resume',
  'next-action-nonce',
] as const

export type OriginRequestOptions = {
  /** Absolute origin URL; only its protocol and host replace the request's. */
  origin: string
  /** Cookie names removed before forwarding. */
  stripCookieNames?: ReadonlySet<string>
  stripAllCookies?: boolean
  /** Path and query merged over the request URL (override query params win). */
  pathOverride?: string | null
  requestId?: string
  requestIdHeader?: string
  /** Shared secret proving the request came through the Worker. Any client copy is removed. */
  sharedSecret?: { header: string; value: string | undefined }
  /** Keep a non-Basic `authorization` header (for example Bearer). Dropped by default. */
  preserveNonBasicAuthorization?: boolean
  /** Keep a Basic `authorization` header. Dropped by default. */
  preserveBasicAuthorization?: boolean
  /** Force `accept-encoding: identity`, required when the response enters a shared cache. */
  forceIdentityEncoding?: boolean
  /** Hostnames that also get identity encoding (local development). */
  identityEncodingHostnames?: readonly string[]
  /** Extra headers deleted from the client request, for example identity or control headers. */
  stripHeaders?: Iterable<string>
  /** Headers set last, after every strip. */
  setHeaders?: Readonly<Record<string, string>>
}

/** Builds the sanitized request forwarded to an origin. Redirects stay manual. */
export function buildOriginRequest(request: Request, options: OriginRequestOptions): Request {
  const original = new URL(request.url)
  const originUrl = new URL(options.origin)
  const url = new URL(request.url)
  url.protocol = originUrl.protocol
  url.host = originUrl.host
  if (options.pathOverride) {
    const override = new URL(options.pathOverride, url)
    const merged = new URLSearchParams(url.search)
    override.searchParams.forEach((value, key) => merged.set(key, value))
    url.pathname = override.pathname
    url.search = merged.toString()
  }

  const headers = new Headers(request.headers)
  const cookie = options.stripAllCookies
    ? null
    : stripCookies(headers.get('cookie'), options.stripCookieNames ?? [])
  if (cookie) headers.set('cookie', cookie)
  else headers.delete('cookie')

  deleteHeaders(headers, CLIENT_SUPPLIED_PROXY_HEADERS_TO_STRIP)
  deleteHeaders(headers, options.stripHeaders ?? [])
  const requestIdHeader = options.requestIdHeader ?? 'x-request-id'
  headers.delete(requestIdHeader)
  if (options.sharedSecret) headers.delete(options.sharedSecret.header)
  const isBasic = /^basic\s/i.test(headers.get('authorization') ?? '')
  if (isBasic ? !options.preserveBasicAuthorization : !options.preserveNonBasicAuthorization) {
    headers.delete('authorization')
  }

  headers.set('x-forwarded-host', original.host)
  headers.set('x-forwarded-proto', original.protocol.replace(':', ''))
  const clientIp = request.headers.get('cf-connecting-ip')
  if (clientIp) headers.set('x-forwarded-for', clientIp)

  const identityHosts = options.identityEncodingHostnames ?? ['localhost', '127.0.0.1']
  if (options.forceIdentityEncoding || identityHosts.includes(originUrl.hostname)) {
    headers.set('accept-encoding', 'identity')
  }
  if (options.sharedSecret?.value)
    headers.set(options.sharedSecret.header, options.sharedSecret.value)
  if (options.requestId) headers.set(requestIdHeader, options.requestId)
  for (const [name, value] of Object.entries(options.setHeaders ?? {})) headers.set(name, value)

  const init: RequestInit & { duplex?: 'half' } = {
    method: request.method,
    headers,
    // 'follow' would resolve redirects inside the Worker and hide them from the client.
    redirect: 'manual',
  }
  if (!METHOD_WITHOUT_BODY.has(request.method)) {
    init.body = request.body
    // Required by undici for streaming bodies; the Workers runtime ignores it.
    init.duplex = 'half'
  }
  return new Request(url, init)
}
