import Stripe from 'stripe'

export type CreateStripeClientOptions = {
  apiKey: string
  /** Injected fetch, e.g. an egress-proxied fetch. Defaults to the global fetch. */
  fetch?: typeof fetch
  timeoutMs?: number
  config?: Stripe.StripeConfig
}

export const DEFAULT_STRIPE_TIMEOUT_MS = 10_000

/** Builds a Stripe client. The caller owns the secret, caching, and lifetime. */
export function createStripeClient(options: CreateStripeClientOptions): Stripe {
  if (!options.apiKey) throw new Error('Stripe apiKey is required')
  return new Stripe(options.apiKey, {
    httpClient: Stripe.createFetchHttpClient(options.fetch),
    timeout: options.timeoutMs ?? DEFAULT_STRIPE_TIMEOUT_MS,
    ...options.config,
  })
}

/** Stripe request options carrying an idempotency key only when one is given. */
export function idempotencyOptions(
  idempotencyKey?: string,
): { idempotencyKey: string } | undefined {
  return idempotencyKey ? { idempotencyKey } : undefined
}
