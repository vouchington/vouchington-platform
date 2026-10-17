import type { JsonSchema, ModelCallResult } from './types.mts'

/** A function the model may call. The input schema is JSON Schema; arguments arrive parsed. */
export type ToolDefinition = {
  name: string
  description: string
  inputSchema: JsonSchema
}

/** One tool call the model made. `input` is the parsed arguments, not yet validated. */
export type ToolCall = {
  id: string
  name: string
  input: unknown
}

export type ToolResultBlock = {
  callId: string
  content: string
  isError?: boolean
}

/**
 * The provider-neutral conversation of a tool-using agent. Each adapter turns it into its own
 * message or item list, so the application keeps one transcript whichever provider serves it.
 */
export type AgentTurnMessage =
  | { role: 'user'; text: string }
  | { role: 'assistant'; text: string; toolCalls: readonly ToolCall[] }
  | { role: 'tool'; results: readonly ToolResultBlock[] }

export type ToolTurnRequest = {
  instructions: string
  messages: readonly AgentTurnMessage[]
  tools: readonly ToolDefinition[]
  maxOutputTokens: number
  safetyIdentifier?: string
  promptCacheKey?: string
  flex?: boolean
  maxRetries?: number
}

/** What one model turn produced: free text, and the tool calls it requires an answer to. */
export type ToolTurnOutput = {
  text: string
  toolCalls: readonly ToolCall[]
}

export type ToolTurnResult = ModelCallResult<ToolTurnOutput>
