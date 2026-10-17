# @vouchington/stripe

Stripe primitives: a client factory, webhook signature verification, typed event narrowing,
request-parameter builders, and response parsers. Primitives only: no dispatcher, no flows, no
retries, no sequencing. `stripe` is a peer dependency; the application owns the client, secrets,
persistence, and membership sync.

```ts
const stripe = createStripeClient({ apiKey, fetch: proxiedFetch })

// Webhook route (the app owns the raw body, the secret, and dispatch)
const event = verifyStripeWebhook({ stripe, payload: rawBody, signature, secret })
if (isStripeEventType(event, 'customer.subscription.updated', 'customer.subscription.deleted')) {
  const { customerId, subscriptionId } = normalizeStripeEvent(event)
  // app persists and enqueues
}

// Checkout: build params, call Stripe yourself
const params = buildSubscriptionCheckoutParams({
  customerId,
  priceId,
  successUrl,
  cancelUrl,
  metadata,
})
const session = await stripe.checkout.sessions.create(params, idempotencyOptions(key))
```

Pagination: `parseStripePage` validates one list response and returns a safe cursor; the caller
owns the loop and its page limit. Catalog: `buildRecurringCatalogPriceParams`,
`pickCatalogPrice`, and `validateRecurringCatalogPrice` take a caller-supplied descriptor
(currency, product metadata); the caller owns lookup, create, and race handling
(`isStripeResourceExistsError`).
