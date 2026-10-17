import { ApiError } from './error.mts'

export type ErrorDigestCopy<Title, Description> = { title: Title; description: Description }

export type ParsedErrorDigest<Title, Description> = ErrorDigestCopy<Title, Description> & {
  status: number
}

/**
 * Parses the `EXPECTED_CLIENT_ERROR;{status}` digest written by `ApiError` for 4xx responses other
 * than 401/403/404. Copy is injected: `copyByStatus` is looked up by status and `fallbackCopy`
 * covers every other status. Returns `null` for unrecognized digests.
 */
export function parseErrorDigest<Title, Description>(
  digest: string | undefined,
  copyByStatus: Readonly<Record<number, ErrorDigestCopy<Title, Description>>>,
  fallbackCopy: ErrorDigestCopy<Title, Description>,
): ParsedErrorDigest<Title, Description> | null {
  const match = digest?.match(/^EXPECTED_CLIENT_ERROR;(\d+)$/)
  if (!match) return null
  const status = Number(match[1])
  return { status, ...(copyByStatus[status] ?? fallbackCopy) }
}

/**
 * Returns the user-safe message from an ApiError, preferring plain-text bodies, then `error` and
 * `message` payload fields, and falls back to `fallback` for other error types.
 */
export function getApiErrorMessage(error: unknown, fallback: string): string {
  if (!(error instanceof ApiError)) return fallback
  if (typeof error.data === 'string' && error.data.length > 0) return error.data
  if (error.data != null && typeof error.data === 'object') {
    for (const field of ['error', 'message']) {
      const value = (error.data as Record<string, unknown>)[field]
      if (typeof value === 'string' && value.length > 0) return value
    }
  }
  return error.message
}

/** Whether an error is an ApiError with a specific error code. */
export function hasErrorCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code
}

/**
 * Builds a checker over an application-owned error-code catalog, so callers match names instead
 * of raw code strings: `const is = createErrorCodeChecker({ tagLimit: 'TAG_LIMIT_REACHED' })`.
 */
export function createErrorCodeChecker<Catalog extends Readonly<Record<string, string>>>(
  catalog: Catalog,
): (error: unknown, name: keyof Catalog) => boolean {
  return (error, name) => hasErrorCode(error, catalog[name]!)
}
