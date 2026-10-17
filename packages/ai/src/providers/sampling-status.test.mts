import { describe, expect, it } from 'vitest'
import { buildAnthropicJsonParams } from './anthropic-json.mts'
import { buildOpenAIJsonParams, parseOpenAIJsonResponse } from './openai-json.mts'
import type { GenerateJsonRequest } from './types.mts'
import { parseSchemaValidJson } from './validate-output.mts'

const request: GenerateJsonRequest<unknown> = {
  instructions: 'i',
  input: 'x',
  schemaName: 'n',
  schema: { type: 'object' },
  parse: (value) => value,
  maxOutputTokens: 10,
}

describe('sampling parameters', () => {
  it('forwards them to each provider', () => {
    const sampled = { ...request, temperature: 0.2, topP: 0.9, topK: 5 }
    expect(buildAnthropicJsonParams('m', sampled)).toMatchObject({
      temperature: 0.2,
      top_p: 0.9,
      top_k: 5,
    })
    expect(buildOpenAIJsonParams(sampled)).toMatchObject({ temperature: 0.2, top_p: 0.9 })
    expect(buildOpenAIJsonParams(sampled)).not.toHaveProperty('top_k')
    expect(buildAnthropicJsonParams('m', request)).not.toHaveProperty('temperature')
  })
})

describe('OpenAI response status', () => {
  const base = { id: 'r', output_text: '{}', usage: { input_tokens: 1, output_tokens: 1 } }

  it.each([
    ['incomplete', 'max_output_tokens', 'output-truncated'],
    ['incomplete', 'content_filter', 'refusal'],
    ['incomplete', undefined, 'invalid-response'],
    ['failed', undefined, 'invalid-response'],
  ])('classifies %s (%s) as %s without parsing', (status, reason, code) => {
    try {
      parseOpenAIJsonResponse(
        { ...base, status, incomplete_details: reason ? { reason } : null },
        request,
        'm',
        't',
      )
      expect.unreachable()
    } catch (error) {
      expect(error).toMatchObject({ code, billedResponse: { responseId: 'r' } })
    }
  })

  it('accepts completed or unspecified status', () => {
    expect(
      parseOpenAIJsonResponse({ ...base, status: 'completed' }, request, 'm', 't').output,
    ).toEqual({})
    expect(parseOpenAIJsonResponse({ ...base, status: null }, request, 'm', 't').output).toEqual({})
  })
})

describe('schema cache', () => {
  it('compiles distinct schema objects that share an $id', () => {
    const make = () => ({
      schema: { $id: 'urn:test:shared', type: 'object' },
      parse: (value: unknown) => value,
    })
    expect(parseSchemaValidJson('{}', make())).toEqual({})
    expect(parseSchemaValidJson('{}', make())).toEqual({})
  })
})
