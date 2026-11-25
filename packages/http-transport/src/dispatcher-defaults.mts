export const EXTERNAL_DISPATCHER_HEADERS_TIMEOUT_MS = 60_000
export const LONG_RUNNING_EXTERNAL_DISPATCHER_HEADERS_TIMEOUT_MS = 300_000
// A maximum gap between body chunks, not a deadline. Keep it generous so sparse streams survive.
export const EXTERNAL_DISPATCHER_BODY_TIMEOUT_MS = 300_000
export const EXTERNAL_DISPATCHER_KEEP_ALIVE_TIMEOUT_MS = 4_000
export const EXTERNAL_DISPATCHER_KEEP_ALIVE_MAX_TIMEOUT_MS = 600_000
export const EXTERNAL_DISPATCHER_CONNECT_TIMEOUT_MS = 10_000

export type ExternalFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

export interface SharedDispatcherTimeouts {
  headersTimeoutMs?: number
  longRunningHeadersTimeoutMs?: number
  bodyTimeoutMs?: number
  keepAliveTimeoutMs?: number
  keepAliveMaxTimeoutMs?: number
  connectTimeoutMs?: number
  connections?: number
}
