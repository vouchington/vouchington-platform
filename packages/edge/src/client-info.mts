const FETCH_METADATA_HEADERS = ['sec-fetch-site', 'sec-fetch-mode', 'sec-fetch-dest'] as const
const SAFE_NAVIGATION_METHODS = new Set(['GET', 'HEAD'])
// Browsers send this Origin on same-origin requests made under a no-referrer policy.
const NO_REFERRER_ORIGIN = 'null'

export type WebBrowserRequest = {
  method: string
  /** The request URL's origin. */
  requestOrigin: string
}

export function hasBrowserFetchMetadata(headers: Headers): boolean {
  return FETCH_METADATA_HEADERS.some((name) => headers.has(name))
}

/**
 * Browser evidence that a request came from the web app on this origin, or from a top-level
 * navigation. Forgeable by non-browser callers, so it only classifies telemetry.
 */
export function isWebBrowserRequest(headers: Headers, request: WebBrowserRequest): boolean {
  if (isTopLevelNavigation(headers, request.method)) return true
  if (headers.get('sec-fetch-site')?.toLowerCase() !== 'same-origin') return false
  const origin = headers.get('origin')
  const referer = headers.get('referer')
  return (
    (origin === null ||
      origin === NO_REFERRER_ORIGIN ||
      parseOrigin(origin) === request.requestOrigin) &&
    (referer === null || parseOrigin(referer) === request.requestOrigin)
  )
}

function isTopLevelNavigation(headers: Headers, method: string): boolean {
  return (
    SAFE_NAVIGATION_METHODS.has(method.toUpperCase()) &&
    headers.get('sec-fetch-mode')?.toLowerCase() === 'navigate' &&
    headers.get('sec-fetch-dest')?.toLowerCase() === 'document'
  )
}

function parseOrigin(value: string): string | null {
  try {
    return new URL(value).origin
  } catch {
    return null
  }
}

export type ClientInfoPolicy = {
  /** Header the edge owns to mark synthetic traffic such as bots or cache fills. */
  requestKindHeader: string
  /** Every header a client may use to describe itself; cleared when the edge cannot vouch. */
  clientInfoHeaderNames: readonly string[]
  /** Header whose `value` identifies the web client; used to drop forged web claims. */
  webClientHeader: { name: string; value: string }
  /** Headers set when browser evidence confirms the web client. */
  webClientHeaders: Readonly<Record<string, string>>
}

export type ClientInfoOptions = WebBrowserRequest & {
  requestKind?: string
}

/**
 * Normalizes client-identification headers before forwarding. Synthetic traffic gets only the
 * request-kind header; browser-evidenced traffic gets the injected web headers; anything else
 * keeps non-web client headers and loses forged web claims.
 */
export function applyClientInfoHeaders(
  headers: Headers,
  policy: ClientInfoPolicy,
  options: ClientInfoOptions,
): void {
  const clear = () => {
    for (const name of policy.clientInfoHeaderNames) headers.delete(name)
  }
  headers.delete(policy.requestKindHeader)
  if (options.requestKind) {
    clear()
    headers.set(policy.requestKindHeader, options.requestKind)
    return
  }
  if (!hasBrowserFetchMetadata(headers)) {
    if (headers.get(policy.webClientHeader.name) === policy.webClientHeader.value) clear()
    return
  }
  clear()
  if (!isWebBrowserRequest(headers, options)) return
  for (const [name, value] of Object.entries(policy.webClientHeaders)) headers.set(name, value)
}
