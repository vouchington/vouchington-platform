import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  type CallToolResult,
  type ListToolsResult,
} from '@modelcontextprotocol/sdk/types.js'

import { restoreIds, withUniqueIds } from './batch-ids.mts'
import { validateToolsRequest } from './validate-request.mts'

/** What became of one dispatched `tools/call`. */
export type ToolCallSettlement = {
  durationMs: number | null
  toolError: boolean
  rateLimited: boolean
}

/** Callbacks `callTool` invokes while it runs, so the handler can observe the call. */
export type ToolCallControls = {
  /** Called once the tool has run, with its duration in milliseconds. */
  onInvoked: (elapsedMs: number) => void
  /** Called when the call is refused for rate limiting after it was admitted. */
  onRateLimited: () => Promise<void>
}

export type StatelessMcpHooks = {
  /** Awaited after an admitted tool call returns an error result, so it can be recorded. */
  onToolError?: (toolName: string, option?: string) => Promise<void>
  onToolRateLimited?: (toolName: string, messageIndex: number, option?: string) => Promise<void>
  /** Fired once when a dispatched `tools/call` settles. Observation only: a throw is swallowed. */
  onToolCallSettled?: (messageIndex: number, settlement: ToolCallSettlement) => void
}

export type StatelessMcpRequest = {
  serverInfo: { name: string; version: string }
  instructions?: string
  request: Request
  parsedBody: unknown
  listTools: () => Promise<ListToolsResult['tools']> | ListToolsResult['tools']
  callTool: (
    call: { name: string; arguments: Record<string, unknown> },
    controls: ToolCallControls,
  ) => Promise<CallToolResult>
  /** Whether a JSON-RPC message is a `tools/call` that will run, and so has a request id. */
  isDispatchedToolCall: (message: unknown) => message is { id: string | number }
  /** Defaults to `validateToolsRequest`. Return a response to short-circuit before the transport. */
  validateRequest?: (parsedBody: unknown) => Response | null
  /** The retry delay of each `tools/call`, by message position, whose rate-limit bucket was spent. */
  rateLimitedCalls: ReadonlyMap<number, number>
  buildRateLimitedResult: (retryAfterSeconds: number) => CallToolResult
  /** The audit option of an admitted call, for the hooks. */
  resolveAuditOption?: (call: {
    name: string
    arguments: Record<string, unknown>
  }) => string | undefined
  hooks?: StatelessMcpHooks
}

/**
 * Handles one Streamable HTTP request without a session: a server and transport per request, in
 * JSON-response mode. Calls are indexed by message position, so duplicate JSON-RPC ids in a batch
 * stay distinct. All started calls finish before the response returns, and the transport and
 * server are closed even on error.
 */
export async function handleStatelessMcpRequest(options: StatelessMcpRequest): Promise<Response> {
  const { request } = options
  // Stateless: there is no server-to-client stream to open and no session to close, so anything
  // but POST is refused up front instead of answering a stream that ends at once and is retried.
  if (request.method !== 'POST') {
    return new Response(null, { status: 405, headers: { Allow: 'POST' } })
  }
  const invalid = (options.validateRequest ?? validateToolsRequest)(options.parsedBody)
  if (invalid) return invalid
  // The SDK answers a request by id, so a batch that reuses an id would return only the first
  // reply. Such a batch is dispatched under unique ids and answered under the original ones.
  const { parsedBody, originalIds } = withUniqueIds(options.parsedBody)

  // The SDK dispatches batches in source order. Positions distinguish duplicate ids whose calls
  // can have different route-limit or in-tool outcomes.
  const callIndexesById = new Map<string | number, number[]>()
  const messages = Array.isArray(parsedBody) ? parsedBody : [parsedBody]
  messages.forEach((message, index) => {
    if (!options.isDispatchedToolCall(message)) return
    const indexes = callIndexesById.get(message.id) ?? []
    indexes.push(index)
    callIndexesById.set(message.id, indexes)
  })

  const server = new Server(options.serverInfo, {
    capabilities: { tools: {} },
    ...(options.instructions === undefined ? {} : { instructions: options.instructions }),
  })
  const pendingToolCalls = new Set<Promise<unknown>>()

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: await options.listTools(),
  }))
  server.setRequestHandler(CallToolRequestSchema, (message, extra) => {
    const call = runToolCall(options, message.params, callIndexesById.get(extra.requestId)?.shift())
    pendingToolCalls.add(call)
    void call.then(
      () => pendingToolCalls.delete(call),
      () => pendingToolCalls.delete(call),
    )
    return call
  })

  // Without a session id generator the transport is stateless.
  const transport = new WebStandardStreamableHTTPServerTransport({ enableJsonResponse: true })
  try {
    await server.connect(transport)
    const response = await transport.handleRequest(request, { parsedBody })
    // The SDK correlates JSON responses by id and may resolve duplicate-id batches early.
    // Finish all started calls before the caller settles anything on response close.
    await Promise.allSettled(pendingToolCalls)
    if (!response) return new Response(null, { status: 202 })
    return originalIds.size > 0 && response.body ? restoreIds(response, originalIds) : response
  } finally {
    await transport.close()
    await server.close()
  }
}

async function runToolCall(
  options: StatelessMcpRequest,
  params: { name: string; arguments?: Record<string, unknown> | undefined },
  messageIndex: number | undefined,
): Promise<CallToolResult> {
  const { hooks } = options
  const call = { name: params.name, arguments: params.arguments ?? {} }
  // Settlement is reported once, even if a later hook rejects or the settlement hook throws.
  let settled = false
  const settle = (settlement: ToolCallSettlement) => {
    if (messageIndex === undefined || settled) return
    settled = true
    try {
      hooks?.onToolCallSettled?.(messageIndex, settlement)
    } catch {
      // Observation only: a failing observer never replaces the tool's result or its error.
    }
  }
  const retryAfterSeconds = options.rateLimitedCalls.get(messageIndex ?? -1)
  if (retryAfterSeconds !== undefined) {
    settle({ durationMs: null, toolError: false, rateLimited: true })
    return options.buildRateLimitedResult(retryAfterSeconds)
  }
  const option = options.resolveAuditOption?.(call)
  let rateLimited = false
  let durationMs: number | null = null
  try {
    const result = await options.callTool(call, {
      onInvoked: (elapsed) => {
        durationMs = elapsed
      },
      onRateLimited: async () => {
        rateLimited = true
        if (messageIndex !== undefined) {
          await hooks?.onToolRateLimited?.(call.name, messageIndex, option)
        }
      },
    })
    const toolError = result.isError === true && !rateLimited
    settle({ durationMs, toolError, rateLimited })
    if (toolError) await hooks?.onToolError?.(call.name, option)
    return result
  } catch (error) {
    settle({ durationMs, toolError: false, rateLimited })
    throw error
  }
}
