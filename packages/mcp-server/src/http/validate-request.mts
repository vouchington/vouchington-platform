import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js'

/**
 * A JSON-RPC error response for a `tools/list` or `tools/call` message that does not match its
 * protocol schema, or null when the body should go on to the transport. Batches and other methods
 * are left to the transport, which answers them itself.
 */
export function validateToolsRequest(parsedBody: unknown): Response | null {
  if (!parsedBody || typeof parsedBody !== 'object' || Array.isArray(parsedBody)) return null

  const request = parsedBody as Record<string, unknown>
  const schema =
    request['method'] === 'tools/list'
      ? ListToolsRequestSchema
      : request['method'] === 'tools/call'
        ? CallToolRequestSchema
        : null
  if (!schema || schema.safeParse(parsedBody).success) return null

  const id =
    typeof request['id'] === 'string' || typeof request['id'] === 'number' ? request['id'] : null
  return Response.json(
    {
      jsonrpc: '2.0',
      id,
      error: { code: ErrorCode.InvalidRequest, message: 'Invalid request' },
    },
    { status: 200 },
  )
}
