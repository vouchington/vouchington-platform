/**
 * Shared request/response classification for the captcha and URL-reputation provider clients.
 * Internal: public subpaths re-export only the types they need.
 */

export interface ProviderRequestInit {
  method: 'GET' | 'POST'
  headers?: Record<string, string>
  body?: string
  signal: AbortSignal
}

/** Injected transport. Wrap undici, an address-pinning dispatcher, or a test fake. */
export type ProviderFetch = (input: string, init: ProviderRequestInit) => Promise<Response>

export type ProviderFailureKind =
  | 'transport'
  | 'rate-limited'
  | 'http'
  | 'invalid-json'
  | 'malformed-response'
  | 'configuration'

/** A provider or transport failure. `retryable` says whether repeating the same call can succeed. */
export interface ProviderFailure {
  kind: ProviderFailureKind
  retryable: boolean
  message: string
  /** HTTP status when the failure came from a response. */
  status: number | null
  /** Parsed `Retry-After`, when the provider sent a usable one. */
  retryAfterMs: number | null
  cause: unknown
}

export interface ProviderCallOptions {
  fetch: ProviderFetch
  /** Per-call timeout. Default 5000. */
  timeoutMs?: number
  /** Caller abort. An abort is rethrown, never classified as a provider failure. */
  signal?: AbortSignal
}

const DEFAULT_PROVIDER_TIMEOUT_MS = 5000

export function providerFailure(
  kind: ProviderFailureKind,
  retryable: boolean,
  message: string,
  extra: { status?: number; retryAfterMs?: number | null; cause?: unknown } = {},
): ProviderFailure {
  return {
    kind,
    retryable,
    message,
    status: extra.status ?? null,
    retryAfterMs: extra.retryAfterMs ?? null,
    cause: extra.cause ?? null,
  }
}

/** Parses `Retry-After` (delay seconds or an HTTP date) into milliseconds, or null. */
export function parseRetryAfterMs(value: string | null, now = Date.now()): number | null {
  const text = value?.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return Number(text) * 1000
  const at = Date.parse(text)
  return Number.isNaN(at) ? null : Math.max(0, at - now)
}

export type ProviderJsonResult =
  | { ok: true; body: unknown }
  | { ok: false; failure: ProviderFailure }

/**
 * Sends one request and returns its parsed JSON body, or a classified failure. Transport errors,
 * timeouts, 408, rate limits, and 5xx are retryable; other non-2xx statuses are not.
 */
export async function callProviderJson(
  label: string,
  input: string,
  init: Omit<ProviderRequestInit, 'signal'>,
  options: ProviderCallOptions & { rateLimitStatuses?: readonly number[] },
): Promise<ProviderJsonResult> {
  const timeout = AbortSignal.timeout(options.timeoutMs ?? DEFAULT_PROVIDER_TIMEOUT_MS)
  const signal = options.signal ? AbortSignal.any([timeout, options.signal]) : timeout
  let response: Response
  try {
    response = await options.fetch(input, { ...init, signal })
  } catch (cause) {
    if (options.signal?.aborted) throw cause
    return {
      ok: false,
      failure: providerFailure('transport', true, `${label} request failed`, { cause }),
    }
  }
  if (!response.ok) {
    return { ok: false, failure: await classifyHttpFailure(label, response, options) }
  }
  try {
    return { ok: true, body: await response.json() }
  } catch (cause) {
    if (options.signal?.aborted) throw cause
    return {
      ok: false,
      failure: providerFailure('invalid-json', true, `${label} returned invalid JSON`, {
        status: response.status,
        cause,
      }),
    }
  }
}

async function classifyHttpFailure(
  label: string,
  response: Response,
  options: { rateLimitStatuses?: readonly number[] },
): Promise<ProviderFailure> {
  const { status } = response
  const retryAfterMs = parseRetryAfterMs(response.headers.get('retry-after'))
  await response.body?.cancel().catch(() => undefined)
  if ((options.rateLimitStatuses ?? [429]).includes(status)) {
    return providerFailure('rate-limited', true, `${label} rate limited (HTTP ${status})`, {
      status,
      retryAfterMs,
    })
  }
  return providerFailure(
    'http',
    status === 408 || status >= 500,
    `${label} returned HTTP ${status}`,
    { status, retryAfterMs },
  )
}

export function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null
}

export function optionalString(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

export function malformedResponse(label: string, detail: string): ProviderFailure {
  return providerFailure('malformed-response', false, `${label} returned ${detail}`)
}
