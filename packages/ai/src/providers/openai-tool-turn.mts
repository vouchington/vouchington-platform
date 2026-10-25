import type { ResponseInputItem } from 'openai/resources/responses/responses'
import { ModelProviderError } from './errors.mts'
import {
  assertCompletedOpenAIResponse,
  openAIBilledResponse,
  type OpenAIResponseLike,
} from './openai-response.mts'
import type {
  AgentTurnMessage,
  ToolCall,
  ToolTurnRequest,
  ToolTurnResult,
} from './tool-turn-types.mts'
import type { BilledModelResponse } from './types.mts'

/**
 * One Responses input item, taken from the installed `openai` SDK so replayed provider items and
 * built params stay assignable to `client.responses.create` without casts.
 */
export type OpenAIInputItem = ResponseInputItem

export type OpenAIToolTurnParams = {
  instructions: string
  input: OpenAIInputItem[]
  max_output_tokens: number
  tools: Array<{
    type: 'function'
    name: string
    description: string
    parameters: Record<string, unknown>
    strict: false
  }>
  tool_choice: 'required'
  safety_identifier?: string
  prompt_cache_key?: string
  service_tier?: 'flex'
}

/** One Responses call, OpenAI-direct or OpenRouter; the app maps `model` and picks the endpoint. */
export type CreateOpenAIToolTurnResponse = (
  params: OpenAIToolTurnParams & { model: string },
  options?: { maxRetries?: number; signal?: AbortSignal },
) => PromiseLike<OpenAIResponseLike>

function toInputItems(message: AgentTurnMessage): OpenAIInputItem[] {
  if (message.role === 'user') return [{ role: 'user', content: message.text }]
  if (message.role === 'tool') {
    return message.results.map((result) => ({
      type: 'function_call_output' as const,
      call_id: result.callId,
      // The Responses API has no error flag, so a failed call says so in its text.
      output: result.isError ? `Error: ${result.content}` : result.content,
    }))
  }
  if (message.providerItems) return [...(message.providerItems as OpenAIInputItem[])]
  return [
    ...(message.text ? [{ role: 'assistant' as const, content: message.text }] : []),
    ...message.toolCalls.map((call) => ({
      type: 'function_call' as const,
      call_id: call.id,
      name: call.name,
      arguments: JSON.stringify(call.input),
    })),
  ]
}

/** Builds Responses params for one tool turn; a tool call is required (`tool_choice: required`). */
export function buildOpenAIToolTurnParams(request: ToolTurnRequest): OpenAIToolTurnParams {
  return {
    instructions: request.instructions,
    input: request.messages.flatMap(toInputItems),
    max_output_tokens: request.maxOutputTokens,
    tools: request.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema,
      strict: false,
    })),
    tool_choice: 'required',
    ...(request.safetyIdentifier ? { safety_identifier: request.safetyIdentifier } : {}),
    ...(request.promptCacheKey ? { prompt_cache_key: request.promptCacheKey } : {}),
    ...(request.flex ? { service_tier: 'flex' as const } : {}),
  }
}

function parseArguments(raw: string, billed: BilledModelResponse): unknown {
  try {
    return JSON.parse(raw)
  } catch (err) {
    throw new ModelProviderError('invalid-response', 'OpenAI tool arguments are not JSON.', {
      retryClass: 'permanent',
      billedResponse: billed,
      cause: err,
    })
  }
}

/** Reads a Responses turn; a turn without a tool call or with bad arguments still billed. */
export function parseOpenAIToolTurn(
  response: OpenAIResponseLike,
  model: string,
  transport: string,
): ToolTurnResult {
  const billed = openAIBilledResponse(response, model, transport)
  assertCompletedOpenAIResponse(response, billed)
  const toolCalls: ToolCall[] = []
  const items = response.output ?? []
  const refused = items.some(
    (item) =>
      item.type === 'message' &&
      (item as { content?: readonly { type: string }[] }).content?.some(
        (part) => part.type === 'refusal',
      ),
  )
  if (refused) {
    throw new ModelProviderError('refusal', 'OpenAI declined the request.', {
      retryClass: 'permanent',
      billedResponse: billed,
    })
  }
  for (const item of items) {
    if (item.type === 'function_call') {
      const call = item as { call_id: string; name: string; arguments: string }
      toolCalls.push({
        id: call.call_id,
        name: call.name,
        input: parseArguments(call.arguments, billed),
      })
    }
  }
  if (toolCalls.length === 0) {
    throw new ModelProviderError('invalid-response', 'OpenAI returned no tool call.', {
      retryClass: 'permanent',
      billedResponse: billed,
    })
  }
  return { ...billed, output: { text: response.output_text, toolCalls, providerItems: items } }
}

/** One Responses turn through an injected function; retries and sequencing stay with the caller. */
export async function callOpenAIToolTurn(
  createResponse: CreateOpenAIToolTurnResponse,
  model: string,
  transport: string,
  request: ToolTurnRequest,
  signal?: AbortSignal,
): Promise<ToolTurnResult> {
  const options =
    request.maxRetries === undefined && !signal
      ? undefined
      : {
          ...(request.maxRetries === undefined ? {} : { maxRetries: request.maxRetries }),
          ...(signal ? { signal } : {}),
        }
  const response = await createResponse({ ...buildOpenAIToolTurnParams(request), model }, options)
  return parseOpenAIToolTurn(response, model, transport)
}
