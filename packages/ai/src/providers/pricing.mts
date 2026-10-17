import type { ModelUsage } from './types.mts'

/** Scale-six USD microunits per one million tokens (USD per million tokens x 1,000,000). */
export type TokenRates = {
  input: number
  cacheRead: number
  /** Null when the provider publishes no such cache-write rate, so such tokens cannot be priced. */
  cacheWrite5m: number | null
  cacheWrite1h: number | null
  output: number
}

/** The rates that apply while the whole prompt is at most `maxPromptTokens` tokens. */
export type PriceBand = { maxPromptTokens: number; rates: TokenRates }

/** Price bands by provider, then model alias, then the service tier the provider reports. */
export type PriceTable = Readonly<
  Record<string, Readonly<Record<string, Readonly<Record<string, readonly PriceBand[]>>>>>
>

/**
 * Providers return a dated snapshot or a routed name (`model-2026-10-01`, `vendor/model`), not the
 * bare alias a price table is keyed by. Strips both so lookups are normalized while a ledger keeps
 * the exact served name for audit.
 */
export function normalizeModelAlias(model: string): string {
  return model.replace(/^[a-z0-9-]+\//, '').replace(/-(\d{4}-\d{2}-\d{2}|\d{8})$/, '')
}

export function getPricedModels(prices: PriceTable, provider: string): readonly string[] {
  return Object.keys(prices[provider] ?? {})
}

export function isPricedModel(prices: PriceTable, provider: string, model: string): boolean {
  const models = prices[provider]
  return models !== undefined && Object.hasOwn(models, normalizeModelAlias(model))
}

function findRates(
  prices: PriceTable,
  provider: string,
  model: string,
  serviceTier: string,
  promptTokens: number,
): TokenRates | null {
  const tiers = prices[provider]?.[normalizeModelAlias(model)]
  const bands = tiers && Object.hasOwn(tiers, serviceTier) ? tiers[serviceTier] : undefined
  return bands?.find((band) => promptTokens <= band.maxPromptTokens)?.rates ?? null
}

/** Uses a provider's authoritative billed USD cost when one is present, in microunits. */
export function getReportedCostMicrounits(usage: ModelUsage): number | null {
  if (usage.reportedCostUsd === undefined) return null
  if (!Number.isFinite(usage.reportedCostUsd) || usage.reportedCostUsd < 0) {
    throw new TypeError('Provider usage cost must be a non-negative finite USD amount')
  }
  const microunits = Math.round(usage.reportedCostUsd * 1_000_000)
  if (!Number.isSafeInteger(microunits)) {
    throw new RangeError('Provider usage cost exceeds the maximum JSON-safe integer')
  }
  return microunits
}

/**
 * The list-price cost of one call in scale-six USD microunits, or null when the served model/tier
 * has no price row (or the call used a cache-write dimension the table has no rate for). The band
 * is chosen by the whole prompt, and it prices the output too.
 */
export function calcCostMicrounits(
  prices: PriceTable,
  provider: string,
  model: string,
  serviceTier: string,
  usage: ModelUsage,
): number | null {
  const rates = findRates(prices, provider, model, serviceTier, usage.inputTokens)
  if (!rates) return null
  if (usage.cacheWrite5mTokens > 0 && rates.cacheWrite5m === null) return null
  if (usage.cacheWrite1hTokens > 0 && rates.cacheWrite1h === null) return null
  const cached = usage.cacheReadTokens + usage.cacheWrite5mTokens + usage.cacheWrite1hTokens
  const uncached = Math.max(0, usage.inputTokens - cached)
  const numerator =
    BigInt(uncached) * BigInt(rates.input) +
    BigInt(usage.cacheReadTokens) * BigInt(rates.cacheRead) +
    BigInt(usage.cacheWrite5mTokens) * BigInt(rates.cacheWrite5m ?? 0) +
    BigInt(usage.cacheWrite1hTokens) * BigInt(rates.cacheWrite1h ?? 0) +
    BigInt(usage.outputTokens) * BigInt(rates.output)
  const result = Number((numerator + 500_000n) / 1_000_000n)
  if (!Number.isSafeInteger(result)) {
    throw new RangeError('AI usage cost exceeds the maximum JSON-safe integer')
  }
  return result
}
