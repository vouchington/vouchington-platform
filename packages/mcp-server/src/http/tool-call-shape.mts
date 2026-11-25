import { CallToolRequestSchema } from '@modelcontextprotocol/sdk/types.js'

function requestId(message: unknown): string | number | null {
  const { id } = message as { id?: unknown }
  return typeof id === 'string' || (typeof id === 'number' && Number.isInteger(id)) ? id : null
}

/** Whether a JSON-RPC message is a valid `tools/call` request carrying a string or integer id. */
export function isDispatchedToolCall(message: unknown): message is { id: string | number } {
  return CallToolRequestSchema.safeParse(message).success && requestId(message) !== null
}

/**
 * Whether a message is a `tools/call` notification (missing or null JSON-RPC id). The MCP server
 * never executes notification-shaped tool calls.
 */
export function isNotificationShapedToolCall(message: unknown): boolean {
  if (typeof message !== 'object' || message === null) return false
  const { method, id } = message as { method?: unknown; id?: unknown }
  return method === 'tools/call' && (id === undefined || id === null)
}
