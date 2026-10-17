import type Anthropic from '@anthropic-ai/sdk'
import { classifyAnthropicError, ModelProviderError } from './errors.mts'
import type { BilledModelResponse, GenerateJsonRequest, ModelCallResult } from './types.mts'
import { anthropicUsageToModelUsage } from './usage.mts'
import { parseSchemaValidJson } from './validate-output.mts'

export type CreateAnthropicMessage = (
  params: Anthropic.MessageCreateParamsNonStreaming,
  options?: { signal?: AbortSignal },
) => PromiseLike<Anthropic.Message>

/** Builds the Messages params for a JSON answer constrained by `output_config.format`. */
export function buildAnthropicJsonParams(
  model: string,
  request: GenerateJsonRequest<unknown>,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: request.maxOutputTokens,
    system: request.instructions,
    messages: [{ role: 'user', content: request.input }],
    output_config: { format: { type: 'json_schema', schema: request.schema } },
    ...(request.safetyIdentifier ? { metadata: { user_id: request.safetyIdentifier } } : {}),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.topP === undefined ? {} : { top_p: request.topP }),
    ...(request.topK === undefined ? {} : { top_k: request.topK }),
  }
}

function unusable(
  code: 'refusal' | 'output-truncated' | 'invalid-response',
  message: string,
  billedResponse: BilledModelResponse,
  cause?: unknown,
): ModelProviderError {
  return new ModelProviderError(code, message, { retryClass: 'permanent', billedResponse, cause })
}

export function anthropicBilledResponse(message: Anthropic.Message): BilledModelResponse {
  return {
    provider: 'anthropic',
    transport: 'direct',
    model: message.model,
    responseId: message.id,
    serviceTier: message.usage.service_tier ?? 'standard',
    usage: anthropicUsageToModelUsage(message.usage),
  }
}

/**
 * Turns a 2xx Messages answer into a result. A refusal, truncation, missing text or schema-invalid
 * answer still billed, so the thrown `ModelProviderError` carries the billed response.
 */
export function parseAnthropicJsonMessage<T>(
  message: Anthropic.Message,
  request: GenerateJsonRequest<T>,
): ModelCallResult<T> {
  const billed = anthropicBilledResponse(message)
  if (message.stop_reason === 'refusal') {
    throw unusable('refusal', 'Anthropic declined the request.', billed)
  }
  if (message.stop_reason === 'max_tokens') {
    throw unusable('output-truncated', 'Anthropic output hit max_tokens.', billed)
  }
  const text = message.content.find((block) => block.type === 'text')
  if (!text) throw unusable('invalid-response', 'Anthropic returned no text.', billed)
  try {
    return { ...billed, output: parseSchemaValidJson(text.text, request) }
  } catch (err) {
    throw unusable('invalid-response', 'Anthropic output failed validation.', billed, err)
  }
}

/**
 * One Messages call with an injected client function. Transport failures are classified; the
 * caller decides about retries, spend caps, and recording the billed response.
 */
export async function callAnthropicJson<T>(
  createMessage: CreateAnthropicMessage,
  model: string,
  request: GenerateJsonRequest<T>,
  signal?: AbortSignal,
): Promise<ModelCallResult<T>> {
  let message: Anthropic.Message
  try {
    message = await createMessage(
      buildAnthropicJsonParams(model, request),
      signal ? { signal } : undefined,
    )
  } catch (err) {
    throw classifyAnthropicError(err)
  }
  return parseAnthropicJsonMessage(message, request)
}
