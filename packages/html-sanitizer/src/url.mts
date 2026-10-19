/** Allows relative URLs and the supplied schemes. Rejects scheme-relative and obfuscated schemes. */
export function isSafeUrl(value: string, allowedSchemes: ReadonlySet<string>): boolean {
  const normalized = value.trim().replace(/[\t\n\f\r ]+/g, '')
  if (!normalized || normalized.replaceAll('\\', '/').startsWith('//')) return false
  const colonIndex = normalized.indexOf(':')
  if (colonIndex === -1) return true

  const separatorIndex = firstUrlPathQueryOrFragmentIndex(normalized)
  if (separatorIndex !== -1 && separatorIndex < colonIndex) return true

  const scheme = normalized.slice(0, colonIndex)
  if (!/^[a-z][a-z0-9+.-]*$/i.test(scheme)) return false
  return allowedSchemes.has(scheme.toLowerCase())
}

function firstUrlPathQueryOrFragmentIndex(value: string): number {
  const indexes = ['/', '?', '#'].flatMap((separator) => {
    const index = value.indexOf(separator)
    return index === -1 ? [] : [index]
  })
  return indexes.length > 0 ? Math.min(...indexes) : -1
}
