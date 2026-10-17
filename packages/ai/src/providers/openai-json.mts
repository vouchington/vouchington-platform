import { ModelProviderError } from './errors.mts'
import type { GenerateJsonRequest, ModelCallResult } from './types.mts'
import {
  assertCompletedOpenAIResponse,
  openAIBilledResponse,
  type OpenAIResponseLike,
} from './openai-response.mts'
import { parseSchemaValidJson } from './validate-output.mts'

export type OpenAIJsonParams = {
  instructions: string
  input: string
  max_output_tokens: number
  safety_identifier?: string
  prompt_cache_key?: string
  service_tier?: 'flex'
  temperature?: number
  top_p?: number
  text: {
    format: { type: 'json_schema'; name: string; schema: Record<string, unknown>; strict: true }
  }
}

/** One Responses call, OpenAI-direct or OpenRouter; the app maps `model` and picks the endpoint. */
export type CreateOpenAIResponse = (
  params: OpenAIJsonParams & { model: string },
  options?: { maxRetries: number },
) => PromiseLike<OpenAIResponseLike>

/** Builds Responses params for a JSON answer in the `json_schema` text format. */
export function buildOpenAIJsonParams(request: GenerateJsonRequest<unknown>): OpenAIJsonParams {
  return {
    instructions: request.instructions,
    input: request.input,
    max_output_tokens: request.maxOutputTokens,
    ...(request.safetyIdentifier ? { safety_identifier: request.safetyIdentifier } : {}),
    ...(request.promptCacheKey ? { prompt_cache_key: request.promptCacheKey } : {}),
    ...(request.flex ? { service_tier: 'flex' as const } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.topP === undefined ? {} : { top_p: request.topP }),
    text: {
      format: {
        type: 'json_schema',
        name: request.schemaName,
        schema: request.schema,
        strict: true,
      },
    },
  }
}

/**
 * Turns a completed Responses answer into a result labeled with the caller's `transport`. A
 * schema-invalid answer still billed, so the thrown error carries the billed response.
 */
export function parseOpenAIJsonResponse<T>(
  response: OpenAIResponseLike,
  request: GenerateJsonRequest<T>,
  model: string,
  transport: string,
): ModelCallResult<T> {
  const billed = openAIBilledResponse(response, model, transport)
  assertCompletedOpenAIResponse(response, billed)
  try {
    return { ...billed, output: parseSchemaValidJson(response.output_text, request) }
  } catch (err) {
    throw new ModelProviderError('invalid-response', 'OpenAI output failed validation.', {
      retryClass: 'permanent',
      billedResponse: billed,
      cause: err,
    })
  }
}

/** One Responses call through an injected function; retries and recording stay with the caller. */
export async function callOpenAIJson<T>(
  createResponse: CreateOpenAIResponse,
  model: string,
  transport: string,
  request: GenerateJsonRequest<T>,
): Promise<ModelCallResult<T>> {
  const options = request.maxRetries === undefined ? undefined : { maxRetries: request.maxRetries }
  const response = await createResponse({ ...buildOpenAIJsonParams(request), model }, options)
  return parseOpenAIJsonResponse(response, request, model, transport)
}
