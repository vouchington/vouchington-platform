import type Anthropic from '@anthropic-ai/sdk'
import { describe, expect, it, vi } from 'vitest'
import { buildAnthropicToolTurnParams, callAnthropicToolTurn } from './anthropic-tool-turn.mts'
import { ModelProviderError } from './errors.mts'
import {
  buildOpenAIToolTurnParams,
  callOpenAIToolTurn,
  parseOpenAIToolTurn,
} from './openai-tool-turn.mts'
import type { ToolTurnRequest } from './tool-turn-types.mts'
import { parseAnthropicToolTurn } from './anthropic-tool-turn.mts'

const request: ToolTurnRequest = {
  instructions: 'act',
  maxOutputTokens: 50,
  tools: [{ name: 'lookup', description: 'Look up', inputSchema: { type: 'object' } }],
  messages: [
    { role: 'user', text: 'hi' },
    { role: 'assistant', text: 'ok', toolCalls: [{ id: 'c1', name: 'lookup', input: { q: 1 } }] },
    { role: 'assistant', text: '', toolCalls: [] },
    {
      role: 'tool',
      results: [
        { callId: 'c1', content: 'fine' },
        { callId: 'c2', content: 'bad', isError: true },
      ],
    },
  ],
}

function message(overrides: Partial<Anthropic.Message> = {}): Anthropic.Message {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    model: 'm',
    stop_reason: 'tool_use',
    stop_sequence: null,
    content: [
      { type: 'text', text: 'think', citations: null },
      { type: 'tool_use', id: 'tu1', name: 'lookup', input: { q: 2 } },
    ],
    usage: { input_tokens: 1, output_tokens: 1 },
    ...overrides,
  } as Anthropic.Message
}

describe('anthropic tool turn', () => {
  it('maps the transcript', () => {
    const params = buildAnthropicToolTurnParams('m', { ...request, safetyIdentifier: 'u' })
    expect(params.tool_choice).toEqual({ type: 'any' })
    expect(params.metadata).toEqual({ user_id: 'u' })
    expect(params.messages[1]?.content).toEqual([
      { type: 'text', text: 'ok' },
      { type: 'tool_use', id: 'c1', name: 'lookup', input: { q: 1 } },
    ])
    expect(params.messages[2]?.content).toEqual([])
    expect(params.messages[3]?.content).toEqual([
      { type: 'tool_result', tool_use_id: 'c1', content: 'fine' },
      { type: 'tool_result', tool_use_id: 'c2', content: 'bad', is_error: true },
    ])
    expect(buildAnthropicToolTurnParams('m', request)).not.toHaveProperty('metadata')
  })

  it('returns text and tool calls', async () => {
    const create = vi.fn().mockResolvedValue(message())
    const result = await callAnthropicToolTurn(create, 'm', request, new AbortController().signal)
    expect(result.output).toEqual({
      text: 'think',
      toolCalls: [{ id: 'tu1', name: 'lookup', input: { q: 2 } }],
    })
    await callAnthropicToolTurn(create, 'm', request)
    expect(create.mock.calls[1]?.[1]).toBeUndefined()
  })

  it('rethrows classified transport errors', async () => {
    const boom = new Error('x')
    await expect(callAnthropicToolTurn(() => Promise.reject(boom), 'm', request)).rejects.toBe(boom)
  })

  it.each([
    [{ stop_reason: 'refusal' }, 'refusal'],
    [{ stop_reason: 'max_tokens' }, 'output-truncated'],
    [{ content: [{ type: 'text', text: 'only', citations: null }] }, 'invalid-response'],
  ])('flags unusable turns (%#)', (overrides, code) => {
    try {
      parseAnthropicToolTurn(message(overrides as Partial<Anthropic.Message>))
      expect.unreachable()
    } catch (error) {
      expect(error).toBeInstanceOf(ModelProviderError)
      expect(error).toMatchObject({ code, billedResponse: { responseId: 'msg_1' } })
    }
  })
})

describe('openai tool turn', () => {
  const response = {
    id: 'r1',
    output_text: 'words',
    output: [
      { type: 'message' },
      { type: 'function_call', call_id: 'f1', name: 'lookup', arguments: '{"q":3}' },
    ],
  }

  it('maps the transcript', () => {
    const params = buildOpenAIToolTurnParams({
      ...request,
      safetyIdentifier: 'u',
      promptCacheKey: 'k',
      flex: true,
    })
    expect(params).toMatchObject({
      tool_choice: 'required',
      safety_identifier: 'u',
      prompt_cache_key: 'k',
      service_tier: 'flex',
    })
    expect(params.input).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'ok' },
      { type: 'function_call', call_id: 'c1', name: 'lookup', arguments: '{"q":1}' },
      { type: 'function_call_output', call_id: 'c1', output: 'fine' },
      { type: 'function_call_output', call_id: 'c2', output: 'Error: bad' },
    ])
    expect(buildOpenAIToolTurnParams(request)).not.toHaveProperty('service_tier')
  })

  it('returns tool calls and passes options', async () => {
    const create = vi.fn().mockResolvedValue(response)
    const signal = new AbortController().signal
    const result = await callOpenAIToolTurn(
      create,
      'm',
      'direct',
      { ...request, maxRetries: 1 },
      signal,
    )
    expect(result.output).toEqual({
      text: 'words',
      toolCalls: [{ id: 'f1', name: 'lookup', input: { q: 3 } }],
    })
    expect(create.mock.calls[0]?.[1]).toEqual({ maxRetries: 1, signal })
    await callOpenAIToolTurn(create, 'm', 'direct', request)
    expect(create.mock.calls[1]?.[1]).toBeUndefined()
    await callOpenAIToolTurn(create, 'm', 'direct', request, signal)
    expect(create.mock.calls[2]?.[1]).toEqual({ signal })
    await callOpenAIToolTurn(create, 'm', 'direct', { ...request, maxRetries: 0 })
    expect(create.mock.calls[3]?.[1]).toEqual({ maxRetries: 0 })
  })

  it.each([
    [{ ...response, output: [] }, 'invalid-response'],
    [{ id: 'r1', output_text: 'x' }, 'invalid-response'],
    [
      { ...response, output: [{ type: 'function_call', call_id: 'f', name: 'n', arguments: '{' }] },
      'invalid-response',
    ],
    [
      { ...response, status: 'incomplete', incomplete_details: { reason: 'max_output_tokens' } },
      'output-truncated',
    ],
  ])('flags unusable turns (%#)', (bad, code) => {
    try {
      parseOpenAIToolTurn(bad, 'm', 't')
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ code, billedResponse: { responseId: 'r1' } })
    }
  })
})
