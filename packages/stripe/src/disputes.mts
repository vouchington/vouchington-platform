import type Stripe from 'stripe'

export type StripeDisputeStatusCategory = 'open' | 'lost' | 'closed'

/** Classifies a Stripe dispute status as open, lost, or closed. Fails closed on unknown statuses. */
export function classifyStripeDisputeStatus(status: string): StripeDisputeStatusCategory {
  switch (status) {
    case 'lost':
      return 'lost'
    case 'needs_response':
    case 'under_review':
    case 'appeal_needs_response':
    case 'appeal_under_review':
    case 'warning_needs_response':
    case 'warning_under_review':
      return 'open'
    case 'prevented':
    case 'warning_closed':
    case 'won':
      return 'closed'
    default:
      throw new Error(`Unsupported Stripe dispute status: ${status}`)
  }
}

export type StripeDisputeSettlement = {
  lostDisputeAmountMinorUnits: number
  hasOpenDispute: boolean
}

export type StripeDisputeLike = Pick<Stripe.Dispute, 'status'> & {
  amount?: number | undefined
  currency?: string | undefined
}

/**
 * Summarizes disputes for a payment in `currency`: sums lost dispute amounts and flags whether any
 * dispute is still open. Throws on currency mismatch for lost disputes or on unsupported statuses.
 */
export function summarizeStripeDisputes(
  disputes: Iterable<StripeDisputeLike>,
  currency: string,
): StripeDisputeSettlement {
  let lostDisputeAmountMinorUnits = 0
  let hasOpenDispute = false
  for (const dispute of disputes) {
    const category = classifyStripeDisputeStatus(dispute.status)
    if (category === 'lost') {
      if (dispute.currency !== currency)
        throw new Error(
          `Stripe dispute currency ${String(dispute.currency)} did not match ${currency}`,
        )
      if (typeof dispute.amount !== 'number' || !Number.isFinite(dispute.amount))
        throw new Error('Stripe lost dispute is missing a finite amount')
      lostDisputeAmountMinorUnits += dispute.amount
    } else if (category === 'open') {
      hasOpenDispute = true
    }
  }
  return { lostDisputeAmountMinorUnits, hasOpenDispute }
}
