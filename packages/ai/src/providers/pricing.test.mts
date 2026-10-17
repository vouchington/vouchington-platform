import { describe, expect, it } from 'vitest'
import {
  calcCostMicrounits,
  getPricedModels,
  getReportedCostMicrounits,
  isPricedModel,
  normalizeModelAlias,
  type PriceTable,
} from './pricing.mts'
import { assertSupportedRequest } from './support.mts'
import type { ModelUsage } from './types.mts'
import { anthropicUsageToModelUsage, openAIUsageToModelUsage } from './usage.mts'

const rates = {
  input: 100_000,
  cacheRead: 10_000,
  cacheWrite5m: 125_000,
  cacheWrite1h: null,
  output: 500_000,
}
const prices: PriceTable = {
  acme: {
    'model-a': {
      standard: [
        { maxPromptTokens: 1000, rates },
        { maxPromptTokens: Infinity, rates: { ...rates, input: 200_000 } },
      ],
    },
  },
}
const usage = (overrides: Partial<ModelUsage> = {}): ModelUsage => ({
  inputTokens: 1000,
  cacheReadTokens: 0,
  cacheWrite5mTokens: 0,
  cacheWrite1hTokens: 0,
  outputTokens: 1000,
  reasoningOutputTokens: 0,
  ...overrides,
})

describe('pricing', () => {
  it('normalizes snapshots and routed names', () => {
    expect(normalizeModelAlias('vendor/model-a-2026-10-01')).toBe('model-a')
    expect(normalizeModelAlias('model-a-20261001')).toBe('model-a')
    expect(normalizeModelAlias('model-a')).toBe('model-a')
  })

  it('lists priced models', () => {
    expect(getPricedModels(prices, 'acme')).toEqual(['model-a'])
    expect(getPricedModels(prices, 'other')).toEqual([])
    expect(isPricedModel(prices, 'acme', 'model-a-2026-10-01')).toBe(true)
    expect(isPricedModel(prices, 'acme', 'nope')).toBe(false)
    expect(isPricedModel(prices, 'other', 'model-a')).toBe(false)
  })

  it('prices uncached, cached and output tokens by prompt band', () => {
    expect(calcCostMicrounits(prices, 'acme', 'model-a', 'standard', usage())).toBe(600)
    expect(
      calcCostMicrounits(prices, 'acme', 'model-a', 'standard', usage({ inputTokens: 2000 })),
    ).toBe(900)
    expect(
      calcCostMicrounits(
        prices,
        'acme',
        'model-a',
        'standard',
        usage({ cacheReadTokens: 400, cacheWrite5mTokens: 100 }),
      ),
    ).toBe(Math.round((500 * 100_000 + 400 * 10_000 + 100 * 125_000 + 1000 * 500_000) / 1e6))
  })

  it('returns null for unpriced models, tiers, providers and cache dimensions', () => {
    expect(calcCostMicrounits(prices, 'acme', 'nope', 'standard', usage())).toBeNull()
    expect(calcCostMicrounits(prices, 'acme', 'model-a', 'flex', usage())).toBeNull()
    expect(calcCostMicrounits(prices, 'zzz', 'model-a', 'standard', usage())).toBeNull()
    expect(
      calcCostMicrounits(prices, 'acme', 'model-a', 'standard', usage({ cacheWrite1hTokens: 1 })),
    ).toBeNull()
    const noWrite: PriceTable = {
      acme: { m: { standard: [{ maxPromptTokens: 9, rates: { ...rates, cacheWrite5m: null } }] } },
    }
    expect(calcCostMicrounits(noWrite, 'acme', 'm', 'standard', usage({ inputTokens: 5 }))).toBe(501)
    expect(
      calcCostMicrounits(
        noWrite,
        'acme',
        'm',
        'standard',
        usage({ inputTokens: 5, cacheWrite5mTokens: 1 }),
      ),
    ).toBeNull()
  })

  it('throws when a cost is not a safe integer', () => {
    const huge: PriceTable = {
      acme: {
        m: {
          standard: [
            { maxPromptTokens: Infinity, rates: { ...rates, output: Number.MAX_SAFE_INTEGER } },
          ],
        },
      },
    }
    expect(() =>
      calcCostMicrounits(huge, 'acme', 'm', 'standard', usage({ outputTokens: 10 ** 12 })),
    ).toThrow(RangeError)
  })

  it('reads reported costs', () => {
    expect(getReportedCostMicrounits(usage())).toBeNull()
    expect(getReportedCostMicrounits(usage({ reportedCostUsd: 0.0123456 }))).toBe(12346)
    expect(() => getReportedCostMicrounits(usage({ reportedCostUsd: -1 }))).toThrow(TypeError)
    expect(() => getReportedCostMicrounits(usage({ reportedCostUsd: NaN }))).toThrow(TypeError)
    expect(() => getReportedCostMicrounits(usage({ reportedCostUsd: 1e300 }))).toThrow(RangeError)
  })
})

describe('assertSupportedRequest', () => {
  const policy = { prices, rejectsSamplingParameters: new Set(['acme:model-a']) }
  const selection = { provider: 'acme', model: 'model-a-2026-10-01' }

  it('rejects unpriced models and unsupported sampling parameters', () => {
    expect(() => assertSupportedRequest({ provider: 'acme', model: 'x' }, {}, policy)).toThrow(
      /no price row/,
    )
    expect(() => assertSupportedRequest(selection, { topK: 1 }, policy)).toThrow(/does not accept/)
    expect(() => assertSupportedRequest(selection, { temperature: 0 }, policy)).toThrow()
    expect(() => assertSupportedRequest(selection, { topP: 1 }, policy)).toThrow()
    expect(() => assertSupportedRequest(selection, {}, policy)).not.toThrow()
    expect(() => assertSupportedRequest(selection, { topK: 1 }, { prices })).not.toThrow()
  })
})

describe('usage normalization', () => {
  it('normalizes Anthropic usage', () => {
    expect(
      anthropicUsageToModelUsage({
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 5,
        cache_creation: { ephemeral_5m_input_tokens: 2, ephemeral_1h_input_tokens: 3 },
        output_tokens_details: { thinking_tokens: 99 },
      }),
    ).toEqual({
      inputTokens: 20,
      cacheReadTokens: 5,
      cacheWrite5mTokens: 2,
      cacheWrite1hTokens: 3,
      outputTokens: 20,
      reasoningOutputTokens: 20,
    })
    expect(
      anthropicUsageToModelUsage({
        input_tokens: -1,
        output_tokens: -1,
        cache_creation_input_tokens: 4,
      }),
    ).toMatchObject({ inputTokens: 4, cacheWrite5mTokens: 4, outputTokens: 0 })
    expect(anthropicUsageToModelUsage({ input_tokens: 1, output_tokens: 1 })).toMatchObject({
      cacheWrite5mTokens: 0,
    })
  })

  it('normalizes OpenAI usage and clamps counts', () => {
    expect(
      openAIUsageToModelUsage({
        input_tokens: 100,
        output_tokens: 10,
        input_tokens_details: { cached_tokens: 60, cache_write_tokens: 90 },
        output_tokens_details: { reasoning_tokens: 4 },
        cost: 0.5,
      }),
    ).toEqual({
      inputTokens: 100,
      cacheReadTokens: 60,
      cacheWrite5mTokens: 40,
      cacheWrite1hTokens: 0,
      outputTokens: 10,
      reasoningOutputTokens: 4,
      reportedCostUsd: 0.5,
    })
    expect(openAIUsageToModelUsage({ input_tokens: -5, output_tokens: 1 })).toMatchObject({
      inputTokens: 0,
      cacheReadTokens: 0,
    })
  })
})
