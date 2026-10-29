import { describe, expect, it } from 'vitest'
import { openAIUsageToModelUsage } from '../providers/usage.mts'
import { StructuredDecisionError } from './errors.mts'
import { buildOpenAIDecisionRequest } from './openai-transport.mts'
import { classifyOpenAIFailure, classifyProviderResponse } from './retry-classification.mts'
import { parseBilledUsage } from './transport.mts'
import type { StructuredDecisionQuestion, StructuredDecisionRequest } from './types.mts'

const options = { url: 'https://example.test/v1/decisions', apiKey: 'k', model: 'm' }
const request: StructuredDecisionRequest = {
  state: 'the state',
  questions: [
    { id: 'n', type: 'noul', question: 'Is it?' },
    { id: 'c', type: 'choice', question: 'Pick', criteria: ['a', 'b'] },
    {
      id: 's',
      type: 'score',
      question: 'Rate',
      criteria: [
        { description: 'low', value: 0 },
        { description: 'high', value: 1 },
      ],
    },
  ],
}

function scoreWithLevels(count: number): StructuredDecisionQuestion {
  return {
    id: 's',
    type: 'score',
    question: 'Rate',
    criteria: Array.from({ length: count }, (_, value) => ({ description: `l${value}`, value })),
  }
}

function predicates(count: number): StructuredDecisionQuestion[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `q${index}`,
    type: 'noul' as const,
    question: 'Is it?',
  }))
}

function code(questions: readonly StructuredDecisionQuestion[]): string | undefined {
  try {
    buildOpenAIDecisionRequest(options, { state: 's', questions })
  } catch (error) {
    return (error as StructuredDecisionError).code
  }
  return undefined
}

describe('buildOpenAIDecisionRequest', () => {
  it('builds the OpenAI decisions body without service tier options', () => {
    const built = buildOpenAIDecisionRequest(options, request)
    expect(built).toEqual({
      url: 'https://example.test/v1/decisions',
      provider: 'OpenAI',
      headers: { authorization: 'Bearer k', 'content-type': 'application/json' },
      body: {
        model: 'm',
        input: 'the state',
        questions: [
          { name: 'n', type: 'predicate', instructions: 'Is it?' },
          {
            name: 'c',
            type: 'choice',
            instructions: 'Pick',
            choices: [
              { value: 'a', description: 'a' },
              { value: 'b', description: 'b' },
            ],
          },
          {
            name: 's',
            type: 'score',
            instructions: 'Rate',
            levels: [
              { label: 'low', description: 'low' },
              { label: 'high', description: 'high' },
            ],
          },
        ],
      },
    })
    expect(built.body).not.toHaveProperty('service_tier')
  })

  it('accepts the question and level limits', () => {
    expect(code(predicates(400))).toBeUndefined()
    expect(code([scoreWithLevels(2)])).toBeUndefined()
    expect(code([scoreWithLevels(10)])).toBeUndefined()
  })

  it('rejects invalid requests', () => {
    expect(code(predicates(401))).toBe('invalid-request')
    expect(code([])).toBe('invalid-request')
    expect(code([...predicates(1), ...predicates(1)])).toBe('invalid-request')
    expect(code([scoreWithLevels(1)])).toBe('invalid-request')
    expect(code([scoreWithLevels(11)])).toBe('invalid-request')
  })
})

describe('classifyOpenAIFailure', () => {
  it('treats 408, 409, 429, 5xx and no response as transient', () => {
    for (const status of [undefined, 408, 409, 429, 500, 503]) {
      expect(classifyOpenAIFailure(status, undefined)).toBe('transient')
    }
    for (const status of [400, 401, 403, 404, 422]) {
      expect(classifyOpenAIFailure(status, undefined)).toBe('permanent')
    }
  })

  it('honours Retry-After on transient failures only', () => {
    const headers = new Headers({ 'retry-after': '3' })
    expect(
      classifyProviderResponse(classifyOpenAIFailure, { status: 409, headers }, undefined),
    ).toEqual({ retryClass: 'transient', retryAfterMs: 3000 })
    expect(
      classifyProviderResponse(classifyOpenAIFailure, { status: 400, headers }, undefined),
    ).toEqual({ retryClass: 'permanent' })
  })
})

describe('OpenAI usage', () => {
  const usage = {
    input_tokens: 100,
    input_tokens_details: { cached_tokens: 60, cache_write_tokens: 10 },
    output_tokens: 20,
    output_tokens_details: { reasoning_tokens: 5 },
    total_tokens: 120,
  }

  it('is accepted by the billing parser and the normalizer', () => {
    expect(parseBilledUsage({ usage })).toEqual({ input_tokens: 100, output_tokens: 20 })
    expect(openAIUsageToModelUsage(usage)).toEqual({
      inputTokens: 100,
      cacheReadTokens: 60,
      cacheWrite5mTokens: 10,
      cacheWrite1hTokens: 0,
      outputTokens: 20,
      reasoningOutputTokens: 5,
    })
  })
})
