import type Anthropic from '@anthropic-ai/sdk'
import { anthropicBilledResponse, type CreateAnthropicMessage } from './anthropic-json.mts'
import { classifyAnthropicError, ModelProviderError } from './errors.mts'
import type {
  AgentTurnMessage,
  ToolCall,
  ToolTurnRequest,
  ToolTurnResult,
} from './tool-turn-types.mts'
import type { BilledModelResponse } from './types.mts'

function toAnthropicMessage(message: AgentTurnMessage): Anthropic.MessageParam {
  if (message.role === 'user') return { role: 'user', content: message.text }
  if (message.role === 'tool') {
    return {
      role: 'user',
      content: message.results.map((result) => ({
        type: 'tool_result' as const,
        tool_use_id: result.callId,
        content: result.content,
        ...(result.isError ? { is_error: true } : {}),
      })),
    }
  }
  return {
    role: 'assistant',
    content: [
      ...(message.text ? [{ type: 'text' as const, text: message.text }] : []),
      ...message.toolCalls.map((call) => ({
        type: 'tool_use' as const,
        id: call.id,
        name: call.name,
        input: call.input,
      })),
    ],
  }
}

/** Builds Messages params for one tool turn; a tool call is required (`tool_choice: any`). */
export function buildAnthropicToolTurnParams(
  model: string,
  request: ToolTurnRequest,
): Anthropic.MessageCreateParamsNonStreaming {
  return {
    model,
    max_tokens: request.maxOutputTokens,
    system: request.instructions,
    messages: request.messages.map(toAnthropicMessage),
    tools: request.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.inputSchema as Anthropic.Tool.InputSchema,
    })),
    tool_choice: { type: 'any' },
    ...(request.safetyIdentifier ? { metadata: { user_id: request.safetyIdentifier } } : {}),
  }
}

function unusable(
  code: 'refusal' | 'output-truncated' | 'invalid-response',
  message: string,
  billedResponse: BilledModelResponse,
): ModelProviderError {
  return new ModelProviderError(code, message, { retryClass: 'permanent', billedResponse })
}

/**
 * Reads a Messages turn. A refusal, a turn cut off at `max_tokens` (whose tool input may be
 * incomplete), or a turn without a tool call is unusable but still billed, so the thrown error
 * carries the billed response.
 */
export function parseAnthropicToolTurn(message: Anthropic.Message): ToolTurnResult {
  const billed = anthropicBilledResponse(message)
  if (message.stop_reason === 'refusal') {
    throw unusable('refusal', 'Anthropic declined the request.', billed)
  }
  if (message.stop_reason === 'max_tokens') {
    throw unusable('output-truncated', 'Anthropic output hit max_tokens.', billed)
  }
  const toolCalls: ToolCall[] = []
  let text = ''
  for (const block of message.content) {
    if (block.type === 'text') text += block.text
    if (block.type === 'tool_use') {
      toolCalls.push({ id: block.id, name: block.name, input: block.input })
    }
  }
  if (toolCalls.length === 0) {
    throw unusable('invalid-response', 'Anthropic returned no tool call.', billed)
  }
  return { ...billed, output: { text, toolCalls } }
}

/** One Messages turn through an injected client function; sequencing turns is the caller's. */
export async function callAnthropicToolTurn(
  createMessage: CreateAnthropicMessage,
  model: string,
  request: ToolTurnRequest,
  signal?: AbortSignal,
): Promise<ToolTurnResult> {
  let message: Anthropic.Message
  try {
    message = await createMessage(
      buildAnthropicToolTurnParams(model, request),
      signal ? { signal } : undefined,
    )
  } catch (err) {
    throw classifyAnthropicError(err)
  }
  return parseAnthropicToolTurn(message)
}
