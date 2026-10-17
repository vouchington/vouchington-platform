import type Stripe from 'stripe'

export type SubscriptionCheckoutInput = {
  customerId: string
  priceId: string
  successUrl: string
  cancelUrl: string
  metadata: Record<string, string>
}

export function buildSubscriptionCheckoutParams(
  input: SubscriptionCheckoutInput,
): Stripe.Checkout.SessionCreateParams {
  return {
    customer: input.customerId,
    mode: 'subscription',
    line_items: [{ price: input.priceId, quantity: 1 }],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: input.metadata,
    subscription_data: { metadata: input.metadata },
  }
}

export type OneTimeCheckoutInput = Omit<SubscriptionCheckoutInput, 'priceId'> & {
  priceAmountMinorUnits: number
  currency: string
  productName: string
}

export function buildOneTimeCheckoutParams(
  input: OneTimeCheckoutInput,
): Stripe.Checkout.SessionCreateParams {
  return {
    customer: input.customerId,
    mode: 'payment',
    line_items: [
      {
        price_data: {
          currency: input.currency,
          unit_amount: input.priceAmountMinorUnits,
          product_data: { name: input.productName },
        },
        quantity: 1,
      },
    ],
    success_url: input.successUrl,
    cancel_url: input.cancelUrl,
    metadata: input.metadata,
  }
}

export type BillingPortalInput = {
  customerId: string
  returnUrl: string
  cancellationSubscriptionId?: string
}

export function buildBillingPortalParams(
  input: BillingPortalInput,
): Stripe.BillingPortal.SessionCreateParams {
  return {
    customer: input.customerId,
    return_url: input.returnUrl,
    ...(input.cancellationSubscriptionId && {
      flow_data: {
        type: 'subscription_cancel',
        subscription_cancel: { subscription: input.cancellationSubscriptionId },
        after_completion: { type: 'redirect', redirect: { return_url: input.returnUrl } },
      },
    }),
  }
}

/** Search query matching a customer by a metadata key; quotes and backslashes are escaped. */
export function buildCustomerSearchParams(
  metadataKey: string,
  value: string,
): Stripe.CustomerSearchParams {
  if (!/^[A-Za-z0-9_]+$/u.test(metadataKey)) throw new Error('Invalid Stripe metadata key')
  const escaped = value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')
  return { query: `metadata["${metadataKey}"]:"${escaped}"` }
}

export function buildCustomerCreateParams(
  metadata: Record<string, string>,
  email?: string,
): Stripe.CustomerCreateParams {
  return email === undefined ? { metadata } : { email, metadata }
}

/** Blanks identifying fields and marks the customer with the given metadata. */
export function buildCustomerRedactionParams(
  metadata: Record<string, string> = { redacted: 'true' },
): Stripe.CustomerUpdateParams {
  return { email: '', name: '', metadata }
}

export type RefundInput = {
  chargeId?: string
  paymentIntentId?: string
  amountMinorUnits?: number
  metadata?: Record<string, string>
}

export function buildRefundParams(input: RefundInput): Stripe.RefundCreateParams {
  return {
    ...(input.chargeId ? { charge: input.chargeId } : {}),
    ...(input.paymentIntentId ? { payment_intent: input.paymentIntentId } : {}),
    ...(input.amountMinorUnits !== undefined ? { amount: input.amountMinorUnits } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
  }
}

export type RefundListInput = {
  chargeId: string | null
  paymentIntentId: string | null
  startingAfter?: string
  limit?: number
}

/** Refund list params for exactly one of charge or payment intent. */
export function buildRefundListParams(input: RefundListInput): Stripe.RefundListParams {
  if (!input.chargeId && !input.paymentIntentId)
    throw new Error('Stripe refund lookup requires a charge or payment intent')
  if (input.chargeId && input.paymentIntentId)
    throw new Error('Stripe refund lookup cannot use both charge and payment intent')
  return {
    ...(input.chargeId ? { charge: input.chargeId } : {}),
    ...(input.paymentIntentId ? { payment_intent: input.paymentIntentId } : {}),
    limit: input.limit ?? 100,
    ...(input.startingAfter ? { starting_after: input.startingAfter } : {}),
  }
}

export function buildPauseCollectionParams(
  behavior: 'void' | 'clear',
): Stripe.SubscriptionUpdateParams {
  return behavior === 'void' ? { pause_collection: { behavior: 'void' } } : { pause_collection: '' }
}

export function buildIdentityVerificationParams(input: {
  returnUrl: string
  metadata: Record<string, string>
}): Stripe.Identity.VerificationSessionCreateParams {
  return {
    type: 'document',
    metadata: input.metadata,
    options: { document: { require_matching_selfie: true, require_live_capture: true } },
    return_url: input.returnUrl,
  }
}

export const SUBSCRIPTION_SCHEDULE_EXPAND = ['schedule.phases.items.price']
export const IDENTITY_RESULT_EXPAND = ['verified_outputs', 'last_verification_report.document']
