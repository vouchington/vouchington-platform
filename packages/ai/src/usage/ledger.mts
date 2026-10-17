import {
  calcCostMicrounits,
  getReportedCostMicrounits,
  type PriceTable,
} from '../providers/pricing.mts'
import type { ModelUsage } from '../providers/types.mts'

export type UsageLedgerInput = {
  provider: string
  transport: string
  /** The model the provider actually served, not the requested alias. */
  model: string
  /** The service tier the provider actually served, not the requested tier. */
  serviceTier: string
  usage: ModelUsage
}

export type UsageLedgerPricing = {
  costMicrounits: number | null
  pricingStatus: 'priced' | 'unpriced'
  currencyCode: 'usd' | null
}

/**
 * The cost columns of one ledger row. A provider-reported cost wins; otherwise list price from the
 * injected table; a model/tier without a price row is `unpriced` (never silently zero), which a
 * spend cap should treat as a breach. Persistence and idempotency are the application's.
 */
export function priceUsageLedgerRow(
  input: UsageLedgerInput,
  prices: PriceTable,
): UsageLedgerPricing {
  const costMicrounits =
    getReportedCostMicrounits(input.usage) ??
    calcCostMicrounits(prices, input.provider, input.model, input.serviceTier, input.usage)
  return {
    costMicrounits,
    pricingStatus: costMicrounits === null ? 'unpriced' : 'priced',
    currencyCode: costMicrounits === null ? null : 'usd',
  }
}
