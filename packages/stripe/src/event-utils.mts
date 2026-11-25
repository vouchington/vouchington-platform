import type Stripe from 'stripe'

export function getStripeObjectString(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null
}

/** Reads an id from a string or an expanded object. */
export function getStripeObjectId(value: unknown): string | null {
  const id = getStripeObjectString(value)
  if (id) return id
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  return getStripeObjectString((value as Record<string, unknown>).id)
}

export function getStripeObjectNumber(value: unknown): number | null {
  return typeof value === 'number' ? value : null
}

export function getStripeObjectBoolean(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null
}

/** Converts a finite Stripe Unix timestamp (seconds) to a valid Date, or null. */
export function getStripeObjectTimestamp(value: unknown): Date | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null
  const date = new Date(value * 1000)
  return Number.isFinite(date.getTime()) ? date : null
}

/**
 * Reads an invoice's subscription id across Stripe API versions: legacy `invoice.subscription`
 * and newer `invoice.parent.subscription_details.subscription` (string or expanded object).
 */
export function getStripeInvoiceSubscriptionId(invoice: unknown): string | null {
  if (invoice === null || typeof invoice !== 'object' || Array.isArray(invoice)) return null
  const record = invoice as Record<string, unknown>
  return getStripeObjectId(record.subscription) ?? getInvoiceParentSubscriptionId(record)
}

export type StripeSubscriptionPeriod = {
  currentPeriodStart: Date | null
  currentPeriodEnd: Date | null
}

/**
 * Reads `current_period_start` and `current_period_end` from a subscription across Stripe API
 * versions: legacy top-level fields and newer `items.data[0]` fields.
 */
export function getStripeSubscriptionPeriod(
  subscription: Stripe.Subscription,
): StripeSubscriptionPeriod {
  const record = subscription as unknown as Record<string, unknown>
  const firstItem = subscription.items.data[0] as unknown as Record<string, unknown> | undefined
  return {
    currentPeriodStart:
      getStripeObjectTimestamp(record.current_period_start) ??
      getStripeObjectTimestamp(firstItem?.current_period_start),
    currentPeriodEnd:
      getStripeObjectTimestamp(record.current_period_end) ??
      getStripeObjectTimestamp(firstItem?.current_period_end),
  }
}

export type NormalizedStripeEvent = {
  stripeCreatedAt: Date
  customerId: string | null
  subscriptionId: string | null
  invoiceId: string | null
  checkoutSessionId: string | null
}

/** Extracts the common correlation ids from any event payload. */
export function normalizeStripeEvent(event: Stripe.Event): NormalizedStripeEvent {
  const object = event.data.object as unknown as Record<string, unknown>
  const objectId = getStripeObjectString(object.id)
  const objectType = getStripeObjectString(object.object)
  return {
    stripeCreatedAt: new Date(event.created * 1000),
    customerId: objectType === 'customer' ? objectId : getStripeObjectId(object.customer),
    subscriptionId:
      objectType === 'subscription' ? objectId : getStripeInvoiceSubscriptionId(object),
    invoiceId: objectType === 'invoice' ? objectId : getStripeObjectId(object.invoice),
    checkoutSessionId: objectType === 'checkout.session' ? objectId : null,
  }
}

/** Newer API versions nest an invoice's subscription under parent.subscription_details. */
function getInvoiceParentSubscriptionId(object: Record<string, unknown>): string | null {
  const parent = object.parent as { subscription_details?: { subscription?: unknown } } | null
  return getStripeObjectId(parent?.subscription_details?.subscription)
}
