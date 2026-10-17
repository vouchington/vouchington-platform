const SAFE_SQL_IDENTIFIER_PATTERN = /^[a-z_][a-z0-9_]*$/u
/** PostgreSQL truncates identifiers beyond this many bytes. */
const MAX_IDENTIFIER_BYTES = 63

/** Partition DDL cannot bind identifiers, so every interpolated name passes this guard. */
export function assertSafeSqlIdentifier(identifier: string): string {
  if (!SAFE_SQL_IDENTIFIER_PATTERN.test(identifier) || identifier.length > MAX_IDENTIFIER_BYTES) {
    throw new Error(`Unsafe SQL identifier: ${identifier}`)
  }
  return identifier
}
