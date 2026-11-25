import Stripe from 'stripe'

export type StripeRequestRejection = 'authentication' | 'rate_limited' | 'invalid_parameters'

export type StripeRequestEventSource = {
  on(event: 'request', listener: (event: Stripe.RequestEvent) => void): void
  off(event: 'request', listener: (event: Stripe.RequestEvent) => void): void
}

export type TrackStripeRequestRejectionOptions = {
  stripe: StripeRequestEventSource
  method: string
  path: string
  idempotencyKey: string
}

const INVALID_PARAMETER_ERROR_CODES = new Set([
  'parameter_invalid_empty',
  'parameter_invalid_integer',
  'parameter_invalid_string_blank',
  'parameter_invalid_string_empty',
  'parameter_missing',
  'parameter_unknown',
  'parameters_exclusive',
])

/**
 * Classifies Stripe SDK errors documented as pre-execution rejections.
 * Other 4xx, network errors, and 5xx remain unknown (`null`).
 */
export function classifyStripeRequestError(error: unknown): StripeRequestRejection | null {
  if (error instanceof Stripe.errors.StripeAuthenticationError && error.statusCode === 401)
    return 'authentication'
  if (
    error instanceof Stripe.errors.StripeRateLimitError &&
    error.statusCode === 429 &&
    error.code !== 'lock_timeout'
  )
    return 'rate_limited'
  if (
    error instanceof Stripe.errors.StripeInvalidRequestError &&
    error.statusCode === 400 &&
    error.code !== undefined &&
    INVALID_PARAMETER_ERROR_CODES.has(error.code)
  )
    return 'invalid_parameters'
  return null
}

const confirmedRejections = new WeakMap<object, StripeRequestRejection>()
const inFlightRequests = new WeakMap<
  StripeRequestEventSource,
  Map<string, { active: number; contended: boolean }>
>()

/**
 * Observes Stripe SDK `'request'` events for one idempotent call so an error is confirmed as a
 * pre-execution rejection only when exactly one matching request was dispatched without
 * concurrent same-key contention on the same client.
 */
export async function trackStripeRequestRejection<T>(
  options: TrackStripeRequestRejectionOptions,
  run: () => Promise<T>,
): Promise<T> {
  const { stripe, method, path, idempotencyKey } = options
  let requests = inFlightRequests.get(stripe)
  if (!requests) {
    requests = new Map()
    inFlightRequests.set(stripe, requests)
  }
  const concurrent = requests.get(idempotencyKey) ?? { active: 0, contended: false }
  concurrent.contended ||= concurrent.active > 0
  concurrent.active++
  requests.set(idempotencyKey, concurrent)
  let providerRequestCount = 0
  const observeRequest = (event: Stripe.RequestEvent) => {
    if (event.idempotency_key === idempotencyKey && event.method === method && event.path === path)
      providerRequestCount++
  }
  stripe.on('request', observeRequest)
  try {
    return await run()
  } catch (error) {
    if (
      !concurrent.contended &&
      providerRequestCount === 1 &&
      typeof error === 'object' &&
      error !== null
    ) {
      const rejection = classifyStripeRequestError(error)
      if (rejection) confirmedRejections.set(error, rejection)
    }
    throw error
  } finally {
    stripe.off('request', observeRequest)
    concurrent.active--
    if (concurrent.active === 0) requests.delete(idempotencyKey)
  }
}

/** Returns the pre-execution rejection confirmed by `trackStripeRequestRejection`, or null. */
export function getStripeRequestRejection(error: unknown): StripeRequestRejection | null {
  return typeof error === 'object' && error !== null
    ? (confirmedRejections.get(error) ?? null)
    : null
}
