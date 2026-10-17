import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import {
  buildAnthropicJsonParams,
  callAnthropicJson,
  parseAnthropicJsonMessage,
} from './anthropic-json.mts'
import { ModelProviderError } from './errors.mts'
import { buildOpenAIJsonParams, callOpenAIJson, parseOpenAIJsonResponse } from './openai-json.mts'
import type { GenerateJsonRequest } from './types.mts'
import { parseSchemaValidJson } from './validate-output.mts'

const schema = {
  type: 'object',
  properties: { ok: { type: 'boolean' } },
  required: ['ok'],
  additionalProperties: false,
}
const request: GenerateJsonRequest<{ ok: boolean }> = {
  instructions: 'be nice',
  input: 'hello',
  schemaName: 'answer',
  schema,
  parse: (value) => value as { ok: boolean },
  maxOutputTokens: 100,
}

function message(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'model-a-2026-10-01',
    stop_reason: 'end_turn',
    stop_sequence: null,
    content: [{ type: 'text', text: '{"ok":true}', citations: null }],
    usage: { input_tokens: 10, output_tokens: 5, service_tier: 'standard' },
    ...overrides,
  } as Anthropic.Message
}

describe('parseSchemaValidJson', () => {
  it('parses, validates, and narrows', () => {
    expect(parseSchemaValidJson('{"ok":true}', request)).toEqual({ ok: true })
    expect(parseSchemaValidJson('{"ok":false}', request)).toEqual({ ok: false })
  })

  it('rejects malformed and schema-invalid output', () => {
    expect(() => parseSchemaValidJson('nope', request)).toThrow('not valid JSON')
    expect(() => parseSchemaValidJson('{"ok":1}', request)).toThrow('does not match the schema')
  })
})

describe('anthropic JSON', () => {
  it('builds params with and without a safety identifier', () => {
    const params = buildAnthropicJsonParams('m', request)
    expect(params).toMatchObject({ model: 'm', max_tokens: 100, system: 'be nice' })
    expect('metadata' in params).toBe(false)
    expect(buildAnthropicJsonParams('m', { ...request, safetyIdentifier: 'u1' }).metadata).toEqual({
      user_id: 'u1',
    })
  })

  it('returns billed output', async () => {
    const createMessage = vi.fn().mockResolvedValue(message())
    const result = await callAnthropicJson(
      createMessage,
      'm',
      request,
      new AbortController().signal,
    )
    expect(result).toMatchObject({
      provider: 'anthropic',
      transport: 'direct',
      responseId: 'msg_1',
      serviceTier: 'standard',
      output: { ok: true },
    })
    expect(createMessage.mock.calls[0]?.[1]).toHaveProperty('signal')
    await callAnthropicJson(createMessage, 'm', request)
    expect(createMessage.mock.calls[1]?.[1]).toBeUndefined()
  })

  it('defaults the service tier', () => {
    const noTier = message({ usage: { input_tokens: 1, output_tokens: 1 } as Anthropic.Usage })
    expect(parseAnthropicJsonMessage(noTier, request).serviceTier).toBe('standard')
  })

  it('classifies transport failures', async () => {
    const boom = new Error('plain')
    await expect(callAnthropicJson(() => Promise.reject(boom), 'm', request)).rejects.toBe(boom)
  })

  it.each([
    [message({ stop_reason: 'refusal' }), 'refusal'],
    [message({ stop_reason: 'max_tokens' }), 'output-truncated'],
    [message({ content: [] }), 'invalid-response'],
    [
      message({ content: [{ type: 'text', text: '{"ok":1}', citations: null }] }),
      'invalid-response',
    ],
  ])('wraps unusable answers with the billed response', (unusable, code) => {
    try {
      parseAnthropicJsonMessage(unusable, request)
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ModelProviderError)
      expect(error).toMatchObject({ code, retryClass: 'permanent' })
      expect((error as ModelProviderError).billedResponse?.responseId).toBe('msg_1')
    }
  })
})

describe('openai JSON', () => {
  const response = {
    id: 'resp_1',
    model: 'served',
    service_tier: 'default',
    usage: { input_tokens: 10, output_tokens: 5 },
    output_text: '{"ok":true}',
  }

  it('builds params for each optional field', () => {
    expect(buildOpenAIJsonParams(request)).toEqual({
      instructions: 'be nice',
      input: 'hello',
      max_output_tokens: 100,
      text: { format: { type: 'json_schema', name: 'answer', schema, strict: true } },
    })
    expect(
      buildOpenAIJsonParams({
        ...request,
        safetyIdentifier: 'u',
        promptCacheKey: 'k',
        flex: true,
      }),
    ).toMatchObject({ safety_identifier: 'u', prompt_cache_key: 'k', service_tier: 'flex' })
  })

  it('calls the injected function and labels the transport', async () => {
    const createResponse = vi.fn().mockResolvedValue(response)
    const result = await callOpenAIJson(createResponse, 'm', 'openrouter', {
      ...request,
      maxRetries: 2,
    })
    expect(result).toMatchObject({
      provider: 'openai',
      transport: 'openrouter',
      model: 'served',
      serviceTier: 'default',
      output: { ok: true },
    })
    expect(createResponse).toHaveBeenCalledWith(expect.objectContaining({ model: 'm' }), {
      maxRetries: 2,
    })
    await callOpenAIJson(createResponse, 'm', 'direct', request)
    expect(createResponse.mock.calls[1]?.[1]).toBeUndefined()
  })

  it('fills missing response metadata', () => {
    const result = parseOpenAIJsonResponse(
      { id: 'r', output_text: '{"ok":true}' },
      request,
      'alias',
      't',
    )
    expect(result).toMatchObject({ model: 'alias', serviceTier: 'unknown-tier' })
    expect(result.usage.inputTokens).toBe(0)
  })

  it('wraps invalid output with the billed response', () => {
    try {
      parseOpenAIJsonResponse({ ...response, output_text: 'x' }, request, 'm', 't')
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ code: 'invalid-response' })
      expect((error as ModelProviderError).billedResponse?.responseId).toBe('resp_1')
    }
  })
})
