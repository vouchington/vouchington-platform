export const SENSITIVE_VALUE = '[Filtered]'
const URL_ATTRIBUTES = [
  'url',
  'url.full',
  'http.url',
  'http.target',
  'http.request.header.referer',
  'http.request.header.referrer',
]
const URL_COMPONENT_ATTRIBUTES = ['url.query', 'http.query', 'url.fragment', 'http.fragment']
export interface ScrubOptions {
  credentialHeaders: readonly string[]
}
export interface ObservableEvent {
  [key: string]: unknown
  breadcrumbs?: Array<{ data?: Record<string, unknown> }>
  request?: object
}

export function stripUrlQueryAndFragment(value: string): string {
  const match = /[?#]/.exec(value)
  return match ? value.slice(0, match.index) : value
}
export function scrubHeaders(
  headers: Record<string, unknown>,
  credentialHeaders: readonly string[],
): Record<string, unknown> {
  const credentials = new Set(credentialHeaders.map((name) => name.toLowerCase()))
  return Object.fromEntries(
    Object.entries(headers).map(([name, value]) => [
      name,
      credentials.has(name.toLowerCase())
        ? SENSITIVE_VALUE
        : isUrlHeader(name) && typeof value === 'string'
          ? stripUrlQueryAndFragment(value)
          : value,
    ]),
  )
}
export function scrubSpanAttributes<T extends Record<string, unknown>>(
  data: T,
  options: ScrubOptions,
): T {
  const credentialKeys = new Set(
    options.credentialHeaders.flatMap((name) => {
      const lower = name.toLowerCase()
      return [`http.request.header.${lower}`, `http.request.header.${lower.replaceAll('-', '_')}`]
    }),
  )
  const result: Array<[string, unknown]> = Object.entries(data).flatMap(([key, value]) => {
    if (URL_COMPONENT_ATTRIBUTES.includes(key)) return []
    if (credentialKeys.has(key) || key.startsWith('http.request.header.cookie.'))
      return [[key, SENSITIVE_VALUE]]
    return [
      [
        key,
        URL_ATTRIBUTES.includes(key) && typeof value === 'string'
          ? stripUrlQueryAndFragment(value)
          : value,
      ],
    ]
  })
  const changed =
    result.length !== Object.keys(data).length || result.some(([key, value]) => data[key] !== value)
  return (changed ? Object.fromEntries(result) : data) as T
}
export function scrubEvent<T extends ObservableEvent>(event: T, options: ScrubOptions): T {
  const request = scrubRequest(event.request, options)
  const breadcrumbs = event.breadcrumbs?.map((breadcrumb) =>
    breadcrumb.data
      ? { ...breadcrumb, data: scrubSpanAttributes(breadcrumb.data, options) }
      : breadcrumb,
  )
  const changed =
    request !== event.request ||
    breadcrumbs?.some((breadcrumb, index) => breadcrumb !== event.breadcrumbs?.[index])
  return changed
    ? {
        ...event,
        ...(request === event.request ? {} : { request }),
        ...(breadcrumbs === event.breadcrumbs ? {} : { breadcrumbs }),
      }
    : event
}
export function composeBeforeSend<T extends ObservableEvent, THint>(
  beforeSend: ((event: T, hint: THint) => T | null | Promise<T | null>) | undefined,
  options: ScrubOptions,
): (event: T, hint: THint) => T | null | Promise<T | null> {
  return (event, hint) => {
    const result = beforeSend ? beforeSend(event, hint) : event
    return result instanceof Promise
      ? result.then((next) => (next === null ? null : scrubEvent(next, options)))
      : result === null
        ? null
        : scrubEvent(result, options)
  }
}
export function isAllowedEnvironment(
  value: string | undefined,
  allowed: readonly string[],
): boolean {
  return value !== undefined && allowed.includes(value)
}
export function shouldReportSpike(count: number, threshold: number): boolean {
  return Number.isFinite(count) && Number.isFinite(threshold) && count >= threshold
}
function scrubRequest<T extends object>(
  request: T | undefined,
  options: ScrubOptions,
): T | undefined {
  if (!request) return request
  const fields = request as Record<string, unknown>
  const headers = isRecord(fields.headers)
    ? scrubHeaders(fields.headers, options.credentialHeaders)
    : fields.headers
  const cookies = isRecord(fields.cookies)
    ? Object.fromEntries(Object.keys(fields.cookies).map((name) => [name, SENSITIVE_VALUE]))
    : fields.cookies
  const result: Array<[string, unknown]> = Object.entries(fields).flatMap(([key, value]) =>
    key === 'query_string'
      ? []
      : [
          [
            key,
            key === 'url' && typeof value === 'string'
              ? stripUrlQueryAndFragment(value)
              : key === 'headers'
                ? headers
                : key === 'cookies'
                  ? cookies
                  : value,
          ],
        ],
  )
  const changed =
    result.length !== Object.keys(fields).length ||
    result.some(([key, value]) => fields[key] !== value)
  return (changed ? Object.fromEntries(result) : request) as T
}
function isUrlHeader(name: string): boolean {
  return ['referer', 'referrer'].includes(name.toLowerCase())
}
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
