import { ModelProviderError } from './errors.mts'
import type { BilledModelResponse, GenerateJsonRequest, ModelCallResult } from './types.mts'
import { openAIUsageToModelUsage, type OpenAIUsageLike } from './usage.mts'
import { parseSchemaValidJson } from './validate-output.mts'

/** The fields of an OpenAI Responses (or OpenRouter) response this package reads. */
export type OpenAIResponseLike = {
  id: string
  model?: string
  service_tier?: string | null
  usage?: OpenAIUsageLike | null
  output_text: string
}

export type OpenAIJsonParams = {
  instructions: string
  input: string
  max_output_tokens: number
  safety_identifier?: string
  prompt_cache_key?: string
  service_tier?: 'flex'
  text: {
    format: { type: 'json_schema'; name: string; schema: Record<string, unknown>; strict: true }
  }
}

/** One Responses call, OpenAI-direct or OpenRouter; the app maps `model` and picks the endpoint. */
export type CreateOpenAIResponse = (
  params: OpenAIJsonParams & { model: string },
  options?: { maxRetries: number },
) => PromiseLike<OpenAIResponseLike>

const NO_USAGE: OpenAIUsageLike = { input_tokens: 0, output_tokens: 0 }

/** Builds Responses params for a JSON answer in the `json_schema` text format. */
export function buildOpenAIJsonParams(request: GenerateJsonRequest<unknown>): OpenAIJsonParams {
  return {
    instructions: request.instructions,
    input: request.input,
    max_output_tokens: request.maxOutputTokens,
    ...(request.safetyIdentifier ? { safety_identifier: request.safetyIdentifier } : {}),
    ...(request.promptCacheKey ? { prompt_cache_key: request.promptCacheKey } : {}),
    ...(request.flex ? { service_tier: 'flex' as const } : {}),
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
  const billed: BilledModelResponse = {
    provider: 'openai',
    transport,
    model: response.model ?? model,
    responseId: response.id,
    serviceTier: response.service_tier ?? 'unknown-tier',
    usage: openAIUsageToModelUsage(response.usage ?? NO_USAGE),
  }
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
