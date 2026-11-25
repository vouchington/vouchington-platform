import Stripe from 'stripe'

export type CreateStripeClientOptions = {
  apiKey: string
  /** Injected fetch, e.g. an egress-proxied fetch. Defaults to the global fetch. */
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
  timeoutMs?: number
  config?: Stripe.StripeConfig
}

export const DEFAULT_STRIPE_TIMEOUT_MS = 10_000

/** Builds a Stripe client. The caller owns the secret, caching, and lifetime. */
export function createStripeClient(options: CreateStripeClientOptions): Stripe {
  if (!options.apiKey) throw new Error('Stripe apiKey is required')
  return new Stripe(options.apiKey, {
    // Stripe types fetchFn as typeof fetch but never uses runtime extras such as Bun's preconnect
    httpClient: Stripe.createFetchHttpClient(options.fetch as typeof fetch | undefined),
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

export type StripeProviderEnvironment = 'test' | 'production'

/** Classifies a Stripe API key (`pk_`, `rk_`, `sk_`) as test or production, or null when unrecognized. */
export function getStripeKeyEnvironment(key: string): StripeProviderEnvironment | null {
  if (/^(?:pk|rk|sk)_test_/.test(key)) return 'test'
  if (/^(?:pk|rk|sk)_live_/.test(key)) return 'production'
  return null
}

/**
 * Derives the Stripe environment from one or more configured API keys.
 * Throws when keys disagree on environment; defaults to `'production'` when none carry a test/live prefix.
 */
export function getStripeProviderEnvironment(...keys: string[]): StripeProviderEnvironment {
  const environments = new Set(
    keys
      .map(getStripeKeyEnvironment)
      .filter((environment): environment is StripeProviderEnvironment => environment !== null),
  )
  if (environments.size > 1) throw new Error('Stripe keys use different environments')
  return environments.values().next().value ?? 'production'
}

export type StripeSubscriptionCanceler = {
  subscriptions: Pick<Stripe['subscriptions'], 'cancel' | 'retrieve'>
}

/**
 * Cancels a subscription and converges via `retrieve` when `DELETE` fails after the cancellation
 * already took effect. Preserves the original cancel failure otherwise.
 */
export async function cancelStripeSubscription(
  stripe: StripeSubscriptionCanceler,
  subscriptionId: string,
  params?: Stripe.SubscriptionCancelParams,
  options?: Stripe.RequestOptions,
): Promise<Stripe.Response<Stripe.Subscription>> {
  try {
    if (options !== undefined)
      return await stripe.subscriptions.cancel(subscriptionId, params, options)
    if (params !== undefined) return await stripe.subscriptions.cancel(subscriptionId, params)
    return await stripe.subscriptions.cancel(subscriptionId)
  } catch (err) {
    try {
      const subscription = await (options !== undefined
        ? stripe.subscriptions.retrieve(subscriptionId, undefined, options)
        : stripe.subscriptions.retrieve(subscriptionId))
      if (subscription.status === 'canceled') return subscription
    } catch {
      // Preserve the original DELETE failure; retrieval is only a convergence check.
    }
    throw err
  }
}
