import type { MembershipStatus } from './types.mts'

export type MembershipMoney = { amountMinorUnits: number; currency: string }

/** Caller-generated key used by provider adapters to make mutations replay-safe. */
export type MembershipProviderOperation = { idempotencyKey: string }

export type NormalizedSubscriptionWebhook<
  SubscriptionId = string,
  CustomerId = string,
  SkuId = string,
> = {
  kind: 'subscription'
  eventId: string
  occurredAt: Date
  subscriptionId: SubscriptionId
  customerId: CustomerId | null
  skuId: SkuId | null
  status: MembershipStatus
  periodEndAt: Date | null
  cancelAtPeriodEnd: boolean
}

export type NormalizedRefundWebhook<PaymentId = string> = {
  kind: 'refund'
  eventId: string
  occurredAt: Date
  paymentId: PaymentId
  amount: MembershipMoney
}

export type NormalizedMembershipWebhook<
  SubscriptionId = string,
  CustomerId = string,
  SkuId = string,
  PaymentId = string,
> =
  | NormalizedSubscriptionWebhook<SubscriptionId, CustomerId, SkuId>
  | NormalizedRefundWebhook<PaymentId>

export type RefundablePayment<PaymentId = string> = {
  paymentId: PaymentId
  amount: MembershipMoney
  refundedAmount: MembershipMoney
  createdAt: Date
  description: string | null
}

export type CreateSubscriptionCapability<Context, Request, Result> = {
  createSubscription(
    context: Context,
    request: Request,
    operation: MembershipProviderOperation,
  ): Promise<Result>
}

export type UpdateSubscriptionCapability<Context, Request, Result> = {
  updateSubscription(
    context: Context,
    request: Request,
    operation: MembershipProviderOperation,
  ): Promise<Result>
}

export type CancelSubscriptionCapability<Context, Request, Result> = {
  cancelSubscription(
    context: Context,
    request: Request,
    operation: MembershipProviderOperation,
  ): Promise<Result>
}

export type NormalizeWebhookCapability<
  Context,
  Request,
  SubscriptionId = string,
  CustomerId = string,
  SkuId = string,
  PaymentId = string,
> = {
  normalizeWebhook(
    context: Context,
    request: Request,
  ): Promise<NormalizedMembershipWebhook<SubscriptionId, CustomerId, SkuId, PaymentId>>
}

export type ListRefundablePaymentsCapability<Context, Request, PaymentId = string> = {
  listRefundablePayments(
    context: Context,
    request: Request,
  ): Promise<RefundablePayment<PaymentId>[]>
}

export type RefundPaymentCapability<Context, Request, Result> = {
  refundPayment(
    context: Context,
    request: Request,
    operation: MembershipProviderOperation,
  ): Promise<Result>
}
