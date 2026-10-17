import {
  calcCostMicrounits,
  getReportedCostMicrounits,
  type PriceTable,
} from '../providers/pricing.mts'
import type { ModelUsage } from '../providers/types.mts'

export type UsageCostInput = {
  provider: string
  /** The model the provider actually served, not the requested alias. */
  model: string
  /** The service tier the provider actually served, not the requested tier. */
  serviceTier: string
  usage: ModelUsage
}

/**
 * The cost of one billed call in microunits: a provider-reported cost wins, otherwise list price
 * from the injected table, otherwise null (no price row, never silently zero). Deriving ledger
 * columns from it (status, currency) and persisting them are the application's.
 */
export function getUsageCostMicrounits(input: UsageCostInput, prices: PriceTable): number | null {
  return (
    getReportedCostMicrounits(input.usage) ??
    calcCostMicrounits(prices, input.provider, input.model, input.serviceTier, input.usage)
  )
}
