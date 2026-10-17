/** Merges header records case-insensitively; later sources win and keep their own casing. */
export function mergeHeaders(
  ...sources: (Readonly<Record<string, string>> | undefined)[]
): Record<string, string> {
  const merged = new Map<string, [string, string]>()
  for (const source of sources) {
    for (const [name, value] of Object.entries(source ?? {})) {
      merged.set(name.toLowerCase(), [name, value])
    }
  }
  return Object.fromEntries(merged.values())
}

/** Appends a `?a=1` query string to an endpoint that may already carry a query or fragment. */
export function appendQuery(endpoint: string, queryString: string): string {
  if (!queryString) return endpoint
  const hashIndex = endpoint.indexOf('#')
  const base = hashIndex === -1 ? endpoint : endpoint.slice(0, hashIndex)
  const hash = hashIndex === -1 ? '' : endpoint.slice(hashIndex)
  const joiner = !base.includes('?') ? '?' : /[?&]$/.test(base) ? '' : '&'
  return `${base}${joiner}${queryString.slice(1)}${hash}`
}

/**
 * Sets `headers` on the init and, for a defined body on a non-GET request, serializes it as JSON
 * with a default `Content-Type` that callers' headers can override. Bodyless requests send no
 * `Content-Type`, which keeps cross-origin GETs free of CORS preflights.
 */
export function applyBody(
  init: RequestInit,
  method: string,
  body: unknown,
  headers: Record<string, string>,
): void {
  if (body === undefined || method === 'GET') {
    init.headers = headers
    return
  }
  init.body = JSON.stringify(body)
  init.headers = mergeHeaders({ 'Content-Type': 'application/json' }, headers)
}
