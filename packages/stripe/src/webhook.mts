import type Stripe from 'stripe'

export class StripeWebhookSignatureError extends Error {
  override readonly name = 'StripeWebhookSignatureError'
}

export type VerifyStripeWebhookOptions = {
  stripe: Pick<Stripe, 'webhooks'>
  /** The exact raw request body. Parsed JSON will not verify. */
  payload: string | Buffer
  signature: string | null | undefined
  secret: string
  /** Seconds of allowed clock skew; Stripe's default is 300. */
  toleranceSeconds?: number
}

/** Verifies the Stripe-Signature header and returns the typed event. Throws StripeWebhookSignatureError. */
export function verifyStripeWebhook(options: VerifyStripeWebhookOptions): Stripe.Event {
  if (!options.signature) throw new StripeWebhookSignatureError('Missing Stripe-Signature header')
  try {
    return options.stripe.webhooks.constructEvent(
      options.payload,
      options.signature,
      options.secret,
      options.toleranceSeconds,
    )
  } catch (cause) {
    throw new StripeWebhookSignatureError('Invalid Stripe webhook signature', { cause })
  }
}

/** Narrows an event to one or more event types. */
export function isStripeEventType<T extends Stripe.Event['type']>(
  event: Stripe.Event,
  ...types: [T, ...T[]]
): event is Extract<Stripe.Event, { type: T }> {
  return (types as string[]).includes(event.type)
}

/** Returns the event narrowed to the given types, or throws. */
export function assertStripeEventType<T extends Stripe.Event['type']>(
  event: Stripe.Event,
  ...types: [T, ...T[]]
): Extract<Stripe.Event, { type: T }> {
  if (!isStripeEventType(event, ...types))
    throw new Error(`Expected Stripe event ${types.join(' | ')}, received ${event.type}`)
  return event
}
