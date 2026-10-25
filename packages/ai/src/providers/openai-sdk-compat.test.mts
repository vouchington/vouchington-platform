import type {
  Response,
  ResponseCreateParamsNonStreaming,
} from 'openai/resources/responses/responses'
import { describe, expect, expectTypeOf, it } from 'vitest'
import { validateCompletedResponse } from '../openai/response.mts'
import {
  buildOpenAIToolTurnParams,
  type CreateOpenAIToolTurnResponse,
  type OpenAIInputItem,
  type OpenAIToolTurnParams,
} from './openai-tool-turn.mts'
import type { OpenAIResponseLike } from './openai-response.mts'

type SdkInput = Exclude<ResponseCreateParamsNonStreaming['input'], string | undefined>

describe('openai SDK compatibility', () => {
  it('assigns built params to responses.create without casts', () => {
    const params = buildOpenAIToolTurnParams({
      instructions: 'act',
      maxOutputTokens: 5,
      tools: [],
      messages: [{ role: 'user', text: 'hi' }],
    })
    const sdkParams: ResponseCreateParamsNonStreaming = { ...params, model: 'm' }
    expect(sdkParams.input).toEqual([{ role: 'user', content: 'hi' }])
    expectTypeOf<
      OpenAIToolTurnParams & { model: string }
    >().toExtend<ResponseCreateParamsNonStreaming>()
    expectTypeOf<OpenAIInputItem[]>().toExtend<SdkInput>()
  })

  it('accepts an SDK create function as the injected callback', () => {
    type SdkCreate = (params: ResponseCreateParamsNonStreaming) => PromiseLike<Response>
    expectTypeOf<SdkCreate>().toExtend<CreateOpenAIToolTurnResponse>()
    expectTypeOf<Response>().toExtend<OpenAIResponseLike>()
  })

  it('returns a validated response as an OpenAIResponseLike', () => {
    const validated = validateCompletedResponse({ id: 'r', status: 'completed', output: [] })
    expectTypeOf(validated.id).toEqualTypeOf<string>()
    expect(validated.id).toBe('r')
  })
})
