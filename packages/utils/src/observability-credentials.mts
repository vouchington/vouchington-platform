import { SENSITIVE_VALUE, isRecord, transformRecord } from './observability-records.mts'

const COOKIE_ATTRIBUTE_PREFIX = 'http.request.header.cookie.'

function lowerSet(names: readonly string[]): ReadonlySet<string> {
  return new Set(names.map((name) => name.toLowerCase()))
}

/** Replace the values of credential headers (case-insensitive exact names). */
export function scrubCredentialHeaders(
  headers: Record<string, unknown>,
  credentialHeaders: readonly string[],
): Record<string, unknown> {
  const credentials = lowerSet(credentialHeaders)
  return transformRecord(headers, (name, value) =>
    credentials.has(name.toLowerCase()) ? SENSITIVE_VALUE : value,
  )
}

/** Replace credential header span attributes (hyphen or underscore spelling) and cookie attributes. */
export function scrubSpanCredentialAttributes<T extends Record<string, unknown>>(
  data: T,
  credentialHeaders: readonly string[],
): T {
  const keys = new Set(
    [...lowerSet(credentialHeaders)].flatMap((name) => [
      `http.request.header.${name}`,
      `http.request.header.${name.replaceAll('-', '_')}`,
    ]),
  )
  return transformRecord(data, (key, value) =>
    keys.has(key) || key.startsWith(COOKIE_ATTRIBUTE_PREFIX) ? SENSITIVE_VALUE : value,
  )
}

/** Replace credential headers and every cookie value on an event request. */
export function scrubRequestCredentialFields<T extends object>(
  request: T | undefined,
  credentialHeaders: readonly string[],
): T | undefined {
  if (!request) return request
  return transformRecord(request, (key, value) => {
    if (key === 'headers' && isRecord(value))
      return scrubCredentialHeaders(value, credentialHeaders)
    return key === 'cookies' && isRecord(value)
      ? transformRecord(value, () => SENSITIVE_VALUE)
      : value
  })
}
