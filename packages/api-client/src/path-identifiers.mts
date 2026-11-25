/**
 * Guards an unencoded URL path identifier against dot-segment traversal and path separators.
 * Throws `Error('Invalid identifier')` on `.`, `..`, `/`, or `\`.
 */
export function assertPathIdentifier(identifier: string): string {
  if (
    identifier === '.' ||
    identifier === '..' ||
    identifier.includes('/') ||
    identifier.includes('\\')
  ) {
    throw new Error('Invalid identifier')
  }
  return identifier
}

/**
 * Guards an identifier that will be passed through `encodeURIComponent` as a single path segment.
 * Allows `/` (which encodes to `%2F`) while still rejecting `.`, `..`, and `\`.
 */
export function assertEncodablePathSegmentIdentifier(identifier: string): string {
  if (identifier === '.' || identifier === '..' || identifier.includes('\\')) {
    throw new Error('Invalid identifier')
  }
  return identifier
}
