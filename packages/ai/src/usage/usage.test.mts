import { describe, expect, it } from 'vitest'
import type { PriceTable } from '../providers/pricing.mts'
import type { ModelUsage } from '../providers/types.mts'
import { parseUtcIsoTime, priceUsageLedgerRow } from './index.mts'

const prices: PriceTable = {
  acme: {
    m: {
      standard: [
        {
          maxPromptTokens: Infinity,
          rates: { input: 1_000_000, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0, output: 0 },
        },
      ],
    },
  },
}
const usage = (overrides: Partial<ModelUsage> = {}): ModelUsage => ({
  inputTokens: 10,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  outputTokens: 0,
  reasoningOutputTokens: 0,
  ...overrides,
})
const row = {
  provider: 'acme',
  transport: 'direct',
  model: 'm-2026-10-01',
  serviceTier: 'standard',
}

describe('priceUsageLedgerRow', () => {
  it('prefers a reported cost, then list price, else unpriced', () => {
    expect(priceUsageLedgerRow({ ...row, usage: usage({ reportedCostUsd: 0.5 }) }, prices)).toEqual(
      {
        costMicrounits: 500_000,
        pricingStatus: 'priced',
        currencyCode: 'usd',
      },
    )
    expect(priceUsageLedgerRow({ ...row, usage: usage() }, prices).costMicrounits).toBe(10)
    expect(priceUsageLedgerRow({ ...row, model: 'x', usage: usage() }, prices)).toEqual({
      costMicrounits: null,
      pricingStatus: 'unpriced',
      currencyCode: null,
    })
  })
})

describe('time helpers', () => {
  it('parses exact UTC ISO times only', () => {
    expect(parseUtcIsoTime('2026-10-01T00:00:00Z')?.toISOString()).toBe('2026-10-01T00:00:00.000Z')
    expect(parseUtcIsoTime('2026-10-01T00:00:00.5Z')?.getUTCMilliseconds()).toBe(500)
    for (const bad of [
      '2026-10-01',
      '2026-10-01T00:00:00+01:00',
      '2026-02-30T00:00:00Z',
      '2026-13-01T00:00:00Z',
      'x',
    ]) {
      expect(parseUtcIsoTime(bad)).toBeNull()
    }
  })
})
