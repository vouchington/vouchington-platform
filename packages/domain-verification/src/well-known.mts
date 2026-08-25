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
  const url = `https://${normalizeHostname(hostname)}${normalizePath(options.path)}`
  const timeoutMs = positiveInteger(options.timeoutMs, 10_000)
  const maxBytes = positiveInteger(options.maxBytes, 4_096)
  let response: Response
  try {
    response = await options.transport.get(url, { headers: { Accept: 'text/plain' }, timeoutMs })
  } catch {
    return null
  }
  if (!response.ok) {
    try {
      await response.body?.cancel()
    } catch {
      // A failed transport cleanup must not mask the verification result.
    }
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
  let completed = false
  try {
    for (;;) {
      const next = await reader.read()
      if (next.done) break
      total += next.value.byteLength
      if (total > maxBytes) throw new RangeError('Response body exceeds maximum size')
      chunks.push(next.value)
    }
    completed = true
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined)
    try {
      reader.releaseLock()
    } catch {
      // A failed transport cleanup must not mask the verification result.
    }
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function normalizeHostname(hostname: string): string {
  if (hostname.length === 0 || hostname.length > 253 || hasNonAscii(hostname)) {
    throw new TypeError('hostname must be an ASCII DNS hostname')
  }
  const labels = hostname.split('.')
  if (labels.some((label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    throw new TypeError('hostname must be an ASCII DNS hostname')
  }
  return hostname.toLowerCase()
}

function hasNonAscii(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    if (value.charCodeAt(index) > 0x7f) return true
  }
  return false
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
