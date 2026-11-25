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

/** Whether an error is an HTTP 429 rate-limit `ApiError`. */
export function isRateLimitError(error: unknown): error is ApiError {
  return error instanceof ApiError && error.status === 429
}

function readRateLimitRetryAfterSeconds(error: unknown): number | null {
  if (!isRateLimitError(error)) return null
  const data = error.data
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null
  const retryAfter = (data as { retry_after?: unknown }).retry_after
  return typeof retryAfter === 'number' && Number.isFinite(retryAfter) && retryAfter > 0
    ? retryAfter
    : null
}

/**
 * Whole seconds to wait from a 429 `ApiError`'s `data.retry_after` field (rounded up), or `0`
 * when absent, non-positive, or not a rate-limit error.
 */
export function getRetryAfterSeconds(error: unknown): number {
  const seconds = readRateLimitRetryAfterSeconds(error)
  return seconds === null ? 0 : Math.ceil(seconds)
}

/**
 * Milliseconds to wait from a 429 `ApiError`'s `data.retry_after` field, or `null` when absent,
 * non-positive, or not a rate-limit error.
 */
export function getRetryAfterMs(error: unknown): number | null {
  const seconds = readRateLimitRetryAfterSeconds(error)
  return seconds === null ? null : seconds * 1000
}

export type ReturnNullForMissingEntityOptions = {
  /** HTTP statuses mapped to `null`. Defaults to `[404]`. */
  nullStatusCodes?: readonly number[]
}

/**
 * Awaits a request and returns `null` when it rejects with an `ApiError` matching one of
 * `nullStatusCodes` (default `[404]`). All other errors propagate unchanged.
 */
export async function returnNullForMissingEntity<T>(
  request: Promise<T>,
  options: ReturnNullForMissingEntityOptions = {},
): Promise<T | null> {
  const nullStatusCodes = options.nullStatusCodes ?? [404]
  try {
    return await request
  } catch (err) {
    if (err instanceof ApiError && nullStatusCodes.includes(err.status)) return null
    throw err
  }
}
