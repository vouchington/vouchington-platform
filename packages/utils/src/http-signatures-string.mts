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

function signingLineForHeader(name: string, values: SigningHeaderValues): string | undefined {
  if (name === '(request-target)') {
    return `(request-target): ${values.method.toLowerCase()} ${values.path}`
  }
  if (name === 'host') return `host: ${values.host}`
  if (name === 'date') return `date: ${values.date}`
  if (name === 'digest') return `digest: ${values.digest}`
  const extra = values.additionalHeaders?.[name]
  return extra === undefined ? undefined : `${name}: ${extra}`
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
