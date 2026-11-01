import { ModelProviderError } from './errors.mts'
import type { BilledModelResponse } from './types.mts'
import { openAIUsageToModelUsage, type OpenAIUsageLike } from './usage.mts'

/** One output item of an OpenAI Responses (or OpenRouter) response that this package reads. */
export type OpenAIOutputItem =
  | { type: 'function_call'; call_id: string; name: string; arguments: string }
  | { type: 'message'; content?: readonly { type: string }[] }
  | { type: string }

/** The fields of an OpenAI Responses (or OpenRouter) response this package reads. */
export type OpenAIResponseLike = {
  id: string
  model?: string
  service_tier?: string | null
  usage?: OpenAIUsageLike | null
  /** Anything other than `completed` (e.g. `incomplete`, `failed`) is not parsed as an answer. */
  status?: string | null
  incomplete_details?: { reason?: string } | null
  output_text: string
  output?: readonly OpenAIOutputItem[]
}

const NO_USAGE: OpenAIUsageLike = { input_tokens: 0, output_tokens: 0 }

/** The ledger-ready description of a response, labeled with the caller's `transport`. */
export function openAIBilledResponse(
  response: OpenAIResponseLike,
  model: string,
  transport: string,
): BilledModelResponse {
  return {
    provider: 'openai',
    transport,
    model: response.model ?? model,
    responseId: response.id,
    serviceTier: response.service_tier ?? 'unknown-tier',
    usage: openAIUsageToModelUsage(response.usage ?? NO_USAGE),
  }
}

function hasRefusalPart(response: OpenAIResponseLike): boolean {
  return (response.output ?? []).some(
    (item) =>
      item.type === 'message' &&
      'content' in item &&
      item.content?.some((part) => part.type === 'refusal'),
  )
}

/**
 * Throws a `ModelProviderError` carrying the billed response when the response did not complete.
 * Truncation and content-filter endings get their own codes.
 */
export function assertCompletedOpenAIResponse(
  response: OpenAIResponseLike,
  billed: BilledModelResponse,
): void {
  if (response.status == null || response.status === 'completed') {
    if (hasRefusalPart(response)) {
      throw new ModelProviderError('refusal', 'OpenAI refused to answer.', {
        retryClass: 'permanent',
        billedResponse: billed,
      })
    }
    return
  }
  const reason = response.incomplete_details?.reason
  const code =
    reason === 'max_output_tokens'
      ? 'output-truncated'
      : reason === 'content_filter'
        ? 'refusal'
        : 'invalid-response'
  throw new ModelProviderError(code, `OpenAI response ended as ${response.status}.`, {
    retryClass: 'permanent',
    billedResponse: billed,
  })
}
