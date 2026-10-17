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

/** Removes named cookies; returns null when no cookie remains. */
export function stripCookies(
  cookieHeader: string | null | undefined,
  cookieNamesToStrip: Iterable<string>,
): string | null {
  const cookies = parseCookies(cookieHeader)
  for (const name of cookieNamesToStrip) cookies.delete(name)
  return cookies.size === 0 ? null : serialize(cookies)
}
