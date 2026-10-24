/** The result is too big for one MCP response; the caller can fix it by asking for less. */
export class McpToolResultTooLargeError extends RangeError {
  override readonly name = 'McpToolResultTooLargeError'
}

/**
 * A tool that declares an output schema returned something its own schema rejects. That is a
 * server bug, not something the caller can fix, so it should be reported and the caller shown a
 * generic failure. The message carries the tool and the rule that failed, never the offending
 * value.
 */
export class McpToolOutputMismatchError extends Error {
  override readonly name = 'McpToolOutputMismatchError'
}
