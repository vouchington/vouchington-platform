export type CookieAttributes = {
  httpOnly: boolean
  maxAge: number
  path: string
  sameSite: 'lax' | 'none' | 'strict'
  secure: boolean
}

const COOKIE_NAME_PATTERN = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/
const COOKIE_VALUE_PATTERN = /^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/
const COOKIE_PATH_PATTERN = /^[\x20-\x3a\x3c-\x7e]+$/
const SAME_SITE_VALUES = new Set(['lax', 'none', 'strict'])

export function serializeCookie(name: string, value: string, attributes: CookieAttributes): string {
  if (!COOKIE_NAME_PATTERN.test(name)) throw new Error('Invalid cookie name')
  if (!COOKIE_VALUE_PATTERN.test(value)) throw new Error(`Invalid cookie value for ${name}`)
  if (!Number.isSafeInteger(attributes.maxAge) || attributes.maxAge < 0)
    throw new Error('Cookie Max-Age must be a non-negative safe integer')
  if (!COOKIE_PATH_PATTERN.test(attributes.path) || !attributes.path.startsWith('/'))
    throw new Error('Cookie Path must be an ASCII absolute path without semicolons')
  if (!SAME_SITE_VALUES.has(attributes.sameSite)) throw new Error('Invalid cookie SameSite value')
  if (typeof attributes.httpOnly !== 'boolean' || typeof attributes.secure !== 'boolean')
    throw new Error('Cookie HttpOnly and Secure attributes must be boolean')
  if (attributes.sameSite === 'none' && !attributes.secure)
    throw new Error('SameSite=None cookies must be Secure')

  const sameSite = `${attributes.sameSite[0]!.toUpperCase()}${attributes.sameSite.slice(1)}`
  const parts = [
    `${name}=${value}`,
    `Max-Age=${attributes.maxAge}`,
    `Path=${attributes.path}`,
    `SameSite=${sameSite}`,
  ]
  if (attributes.httpOnly) parts.push('HttpOnly')
  if (attributes.secure) parts.push('Secure')
  return parts.join('; ')
}
