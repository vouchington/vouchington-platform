export function slugifyAscii(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
}

/** True for a non-empty string of lowercase ASCII letters, digits, and hyphens. */
export function isSlug(value: string): boolean {
  return value.length > 0 && /^[a-z0-9-]+$/.test(value)
}
