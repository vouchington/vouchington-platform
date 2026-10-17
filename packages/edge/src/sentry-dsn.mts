export type SentryDsnConfig = {
  /** Canonical DSN URL. */
  dsn: string
  envelopeUrl: string
  origin: string
  projectId: string
}

/**
 * Parses an `https://<public-key>@<host>/<project>` DSN into canonical parts. Rejects passwords,
 * query, hash, non-numeric projects, and non-canonical paths so an envelope DSN can be compared to
 * a configured one without accepting lookalike spellings. Returns undefined for invalid values.
 */
export function parseSentryDsn(raw: string | undefined): SentryDsnConfig | undefined {
  const value = raw?.trim()
  if (!value) return undefined
  try {
    const url = new URL(value)
    const segments = url.pathname.split('/').filter(Boolean)
    const projectId = segments.at(-1)
    if (
      url.protocol !== 'https:' ||
      !url.username ||
      !/^[A-Za-z0-9_]+$/u.test(url.username) ||
      url.password ||
      url.search ||
      url.hash ||
      !projectId ||
      !/^\d+$/u.test(projectId)
    ) {
      return undefined
    }
    const prefix = segments.slice(0, -1).join('/')
    const base = prefix ? `${prefix}/` : ''
    if (url.pathname !== `/${base}${projectId}`) return undefined
    return {
      dsn: url.toString(),
      envelopeUrl: new URL(`/${base}api/${projectId}/envelope/`, url.origin).toString(),
      origin: url.origin,
      projectId,
    }
  } catch {
    return undefined
  }
}
