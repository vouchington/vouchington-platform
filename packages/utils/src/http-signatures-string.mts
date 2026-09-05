export type SigningHeaderValues = {
  method: string
  path: string
  host: string
  date: string
  digest: string
  additionalHeaders?: Record<string, string> | undefined
}

const SHA256_ALGORITHMS = new Set(['rsa-sha256', 'hs2019'])

export function isSha256SignatureAlgorithm(algorithm: string): boolean {
  return SHA256_ALGORITHMS.has(algorithm)
}

function additionalHeaderValue(
  headers: Record<string, string> | undefined,
  name: string,
): string | undefined {
  if (!headers) return undefined
  if (Object.hasOwn(headers, name)) return headers[name]
  const lower = name.toLowerCase()
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === lower) return value
  }
  return undefined
}

function signingLineForHeader(name: string, values: SigningHeaderValues): string | undefined {
  const lower = name.toLowerCase()
  if (lower === '(request-target)') {
    return `(request-target): ${values.method.toLowerCase()} ${values.path}`
  }
  if (lower === 'host') return `host: ${values.host}`
  if (lower === 'date') return `date: ${values.date}`
  if (lower === 'digest') return `digest: ${values.digest}`
  const extra = additionalHeaderValue(values.additionalHeaders, name)
  return extra === undefined ? undefined : `${lower}: ${extra}`
}

export function buildSigningString(
  headerNames: readonly string[],
  values: SigningHeaderValues,
): string | { error: string } {
  const lines: string[] = []
  for (const name of headerNames) {
    const line = signingLineForHeader(name, values)
    if (line === undefined) return { error: `Unknown signed header: ${name}` }
    lines.push(line)
  }
  return lines.join('\n')
}
