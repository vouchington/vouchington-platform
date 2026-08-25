export interface SecureHttpTransport {
  get(
    url: string,
    options: { headers: Record<string, string>; timeoutMs: number },
  ): Promise<Response>
}

export interface FetchWellKnownTextOptions {
  path: string
  transport: SecureHttpTransport
  timeoutMs?: number
  maxBytes?: number
}

export async function fetchWellKnownText(
  hostname: string,
  options: FetchWellKnownTextOptions,
): Promise<string | null> {
  const url = new URL(normalizePath(options.path), `https://${hostname}`).href
  const timeoutMs = positiveInteger(options.timeoutMs, 10_000)
  const maxBytes = positiveInteger(options.maxBytes, 4_096)
  let response: Response
  try {
    response = await options.transport.get(url, { headers: { Accept: 'text/plain' }, timeoutMs })
  } catch {
    return null
  }
  if (!response.ok) {
    await response.body?.cancel()
    return null
  }
  try {
    const text = (await readResponseText(response, maxBytes)).trim()
    return text || null
  } catch {
    return null
  }
}

export async function verifyWellKnownText(
  hostname: string,
  expectedText: string,
  options: FetchWellKnownTextOptions,
): Promise<boolean> {
  return (await fetchWellKnownText(hostname, options)) === expectedText
}

async function readResponseText(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) throw new RangeError('Response body exceeds maximum size')
      chunks.push(next.value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function normalizePath(path: string): string {
  if (!path.startsWith('/') || path.startsWith('//')) {
    throw new TypeError('path must be an absolute path without a hostname')
  }
  return path
}

function positiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined) return fallback
  if (!Number.isSafeInteger(value) || value <= 0)
    throw new TypeError('Expected a positive safe integer')
  return value
}
