import { describe, expect, it } from 'vitest'
import {
  describeProviderErrorDetail,
  parseProviderErrorDetail,
  readProviderErrorDetail,
} from './provider-error-detail.mts'
import {
  classifyByStatus,
  classifyOpenRouterFailure,
  classifyProviderResponse,
} from './retry-classification.mts'
import { buildDecisionTransportRequest, parseBilledUsage } from './transport.mts'
import type { StructuredDecisionRequest } from './types.mts'

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

describe('buildDecisionTransportRequest', () => {
  it('builds provider questions and merges extra body', () => {
    const built = buildDecisionTransportRequest(
      {
        url: 'https://example.test/decisions',
        provider: 'Example',
        apiKey: 'k',
        model: 'm',
        extraBody: { provider: { only: ['X'] } },
      },
      request,
    )
    expect(built.headers).toEqual({ authorization: 'Bearer k', 'content-type': 'application/json' })
    expect(built.body).toEqual({
      model: 'm',
      state: 'the state',
      provider: { only: ['X'] },
      questions: {
        n: { type: 'noul', instructions: 'Is it?', criteria: { false: 'No', true: 'Yes' } },
        c: { type: 'choice', instructions: 'Pick', criteria: { a: 'a', b: 'b' } },
        s: { type: 'score', instructions: 'Rate', criteria: ['low', 'high'] },
      },
    })
    expect(built).toMatchObject({ url: 'https://example.test/decisions', provider: 'Example' })
    expect(
      buildDecisionTransportRequest({ url: 'u', provider: 'p', apiKey: 'k', model: 'm' }, request)
        .body,
    ).not.toHaveProperty('provider')
  })
})

describe('parseBilledUsage', () => {
  it('reads usable usage', () => {
    expect(parseBilledUsage({ usage: { input_tokens: 1, output_tokens: 2, cost: 0.5 } })).toEqual({
      input_tokens: 1,
      output_tokens: 2,
      cost: 0.5,
    })
    expect(parseBilledUsage({ usage: { input_tokens: 1, output_tokens: 2, cost: 'x' } })).toEqual({
      input_tokens: 1,
      output_tokens: 2,
    })
  })

  it.each([
    [null],
    [{}],
    [{ usage: { input_tokens: -1, output_tokens: 1 } }],
    [{ usage: { input_tokens: 1, output_tokens: NaN } }],
    [{ usage: { input_tokens: 'x', output_tokens: 1 } }],
  ])('returns null for unusable usage (%#)', (raw) => {
    expect(parseBilledUsage(raw)).toBeNull()
  })
})

describe('retry classification', () => {
  it('classifies by status alone', () => {
    expect(classifyByStatus(undefined, undefined)).toBe('transient')
    for (const status of [408, 429, 500, 503])
      expect(classifyByStatus(status, undefined)).toBe('transient')
    expect(classifyByStatus(400, undefined)).toBe('permanent')
  })

  it('applies the OpenRouter rules', () => {
    const detail = (overrides: object) => ({ moderation: false, guardrail: false, ...overrides })
    expect(classifyOpenRouterFailure(402, undefined)).toBe('permanent')
    expect(
      classifyOpenRouterFailure(402, detail({ limitSource: 'openrouter_in_flight_budget' })),
    ).toBe('transient')
    expect(classifyOpenRouterFailure(403, undefined)).toBe('transient')
    expect(classifyOpenRouterFailure(403, detail({ moderation: true }))).toBe('permanent')
    expect(classifyOpenRouterFailure(403, detail({ guardrail: true }))).toBe('permanent')
    expect(classifyOpenRouterFailure(401, undefined)).toBe('permanent')
    expect(classifyOpenRouterFailure(502, undefined)).toBe('transient')
    expect(classifyOpenRouterFailure(undefined, undefined)).toBe('transient')
  })

  it('keeps retry-after only for transient failures', () => {
    const headers = new Headers({ 'retry-after': '4' })
    const detail = { moderation: false, guardrail: false }
    expect(classifyProviderResponse(classifyByStatus, { status: 429, headers }, detail)).toEqual({
      retryClass: 'transient',
      retryAfterMs: 4000,
      detail,
    })
    expect(classifyProviderResponse(classifyByStatus, { status: 400, headers }, undefined)).toEqual(
      {
        retryClass: 'permanent',
      },
    )
    expect(
      classifyProviderResponse(classifyByStatus, { status: 500, headers: {} }, undefined),
    ).toEqual({
      retryClass: 'transient',
    })
  })
})

async function* stream(...chunks: string[]): AsyncGenerator<Uint8Array> {
  for (const chunk of chunks) yield Buffer.from(chunk)
}

describe('provider error detail', () => {
  const body = {
    error: {
      code: 403,
      message: 'blocked: secret words  here',
      metadata: {
        error_type: 'moderation',
        provider_code: 'has space',
        reasons: ['hate', 5, ''],
        provider_name: 'P',
        model_slug: 'm',
        limit_source: 'x',
        flagged_input: 'secret words...here',
      },
    },
  }

  it('keeps safe fields and redacts echoed input', () => {
    const detail = parseProviderErrorDetail(body)
    expect(detail).toMatchObject({
      code: 403,
      errorType: 'moderation',
      reasons: ['hate', '5'],
      providerName: 'P',
      modelSlug: 'm',
      limitSource: 'x',
      moderation: true,
      guardrail: false,
    })
    expect(detail?.providerCode).toBeUndefined()
    expect(detail?.providerMessage).toBe('blocked: [redacted] [redacted]')
    expect(JSON.stringify(detail)).not.toContain('secret')
  })

  it('handles string codes, missing metadata, and guardrails', () => {
    expect(parseProviderErrorDetail({ error: { code: 'rate_limit', message: 7 } })).toEqual({
      code: 'rate_limit',
      moderation: false,
      guardrail: false,
    })
    expect(
      parseProviderErrorDetail({ error: { code: 'bad code!', metadata: { patterns: [] } } }),
    ).toEqual({
      moderation: false,
      guardrail: true,
    })
    expect(
      parseProviderErrorDetail({ error: { message: 'x', metadata: { provider_code: 12 } } }),
    ).toMatchObject({
      providerMessage: 'x',
      providerCode: '12',
    })
    expect(parseProviderErrorDetail({ error: { code: NaN } })).not.toHaveProperty('code')
    expect(parseProviderErrorDetail([])).toBeUndefined()
    expect(parseProviderErrorDetail({ error: 'x' })).toBeUndefined()
  })

  it('reads bounded bodies and never throws', async () => {
    expect(await readProviderErrorDetail({ body: stream(JSON.stringify(body)) })).toMatchObject({
      code: 403,
    })
    expect(await readProviderErrorDetail({ body: null })).toBeUndefined()
    expect(await readProviderErrorDetail({ body: stream('not json') })).toBeUndefined()
    expect(
      await readProviderErrorDetail({ body: stream('{"error":', 'x'.repeat(20_000)) }),
    ).toBeUndefined()
    async function* broken(): AsyncGenerator<Uint8Array> {
      yield* []
      throw new Error('reset')
    }
    expect(await readProviderErrorDetail({ body: broken() })).toBeUndefined()
  })

  it('describes details on one line', () => {
    expect(
      describeProviderErrorDetail({
        code: 402,
        errorType: 't',
        providerCode: 'p',
        providerMessage: 'msg',
        moderation: false,
        guardrail: false,
      }),
    ).toBe('code 402, type t, provider code p: msg')
    expect(
      describeProviderErrorDetail({ providerMessage: 'only', moderation: false, guardrail: false }),
    ).toBe('only')
    expect(describeProviderErrorDetail({ moderation: false, guardrail: false })).toBe('')
  })
})
