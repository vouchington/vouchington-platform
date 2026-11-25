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
  if (
    options.toleranceSeconds !== undefined &&
    !(Number.isInteger(options.toleranceSeconds) && options.toleranceSeconds > 0)
  )
    throw new RangeError('toleranceSeconds must be a positive integer; 0 disables replay checks')
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

/**
 * Unwraps a Stripe event delivered inside an AWS EventBridge PutEvents JSON envelope.
 * Throws `SyntaxError` on invalid JSON and `Error` when `detail` is missing or not a Stripe event.
 */
export function parseStripeEventBridgeEvent(body: string): Stripe.Event {
  const envelope: unknown = JSON.parse(body)
  if (envelope === null || typeof envelope !== 'object' || Array.isArray(envelope))
    throw new Error('EventBridge envelope missing detail')
  const detail = (envelope as { detail?: unknown }).detail
  if (
    detail === null ||
    detail === undefined ||
    typeof detail !== 'object' ||
    Array.isArray(detail)
  )
    throw new Error('EventBridge envelope missing detail')
  const record = detail as Record<string, unknown>
  if (
    typeof record.id !== 'string' ||
    record.id.length === 0 ||
    typeof record.type !== 'string' ||
    record.type.length === 0
  )
    throw new Error('EventBridge envelope detail is not a Stripe event')
  return detail as Stripe.Event
}
