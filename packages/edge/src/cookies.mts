import { parseCookies } from '@vouchington/utils/cookies'

export { parseCookies }

function serialize(cookies: ReadonlyMap<string, string>): string {
  return [...cookies.entries()].map(([name, value]) => `${name}=${value}`).join('; ')
}

/**
 * Sets cookies in a request `cookie` header value. `validate` runs per replacement and should
 * throw for values that are unsafe to forward.
 */
export function replaceCookies(
  cookieHeader: string | null | undefined,
  replacements: Readonly<Record<string, string | undefined>>,
  validate?: (name: string, value: string) => void,
): string {
  const cookies = parseCookies(cookieHeader)
  for (const [name, value] of Object.entries(replacements)) {
    if (value === undefined) continue
    validate?.(name, value)
    cookies.set(name, value)
  }
  return serialize(cookies)
}

/**
 * Removes named cookies; returns null when no cookie remains. The header is returned untouched
 * when no names are stripped, and duplicate names are preserved in order.
 */
export function stripCookies(
  cookieHeader: string | null | undefined,
  cookieNamesToStrip: Iterable<string>,
): string | null {
  const names = new Set(cookieNamesToStrip)
  if (names.size === 0) return cookieHeader || null
  // Filter pairs instead of round-tripping a Map so duplicate names keep their order.
  const kept = (cookieHeader ?? '').split(/;\s*/).filter((part) => {
    const separatorIndex = part.indexOf('=')
    if (separatorIndex <= 0) return false
    return !names.has(part.slice(0, separatorIndex).trim())
  })
  return kept.length === 0 ? null : kept.join('; ')
}
