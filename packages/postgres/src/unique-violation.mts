const UNIQUE_VIOLATION_SQLSTATE = '23505'

/** True for a PostgreSQL `unique_violation` error, whether a `pg` error or a plain `{ code }` object. */
export function isUniqueViolation(
  error: unknown,
): error is { code: typeof UNIQUE_VIOLATION_SQLSTATE } {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === UNIQUE_VIOLATION_SQLSTATE
  )
}
