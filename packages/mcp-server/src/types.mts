/** A JSON Schema document or fragment. */
export type JsonSchema = Record<string, unknown>

/** JSON Schema for a tool's structured result. MCP requires an object at the root. */
export type ToolOutputSchema = { type: 'object'; [keyword: string]: unknown }

/** One REST route a tool call exercises. */
export type ToolApiEndpoint = {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  path: string
}

/**
 * Metadata the package reads from a tool. Applications add their own fields (annotations, scopes,
 * audiences, plans); they pass through the index signature untouched.
 */
export type McpToolMeta = {
  /** Human-readable name that MCP clients display instead of the tool name. */
  title: string
  /** Equivalent REST endpoint(s), or null when none exist. */
  api: readonly ToolApiEndpoint[] | null
  /** Narrows `api` to the endpoints a call with these validated arguments exercises. */
  selectApi?: (args: Record<string, unknown>) => readonly ToolApiEndpoint[]
  /** A merged tool validates the selected source contract before its advertised output union. */
  selectOutputSchema?: (args: Record<string, unknown>) => ToolOutputSchema | undefined
  /** Local pointers into the complete `outputSchema`, keyed by merged-tool option. */
  optionOutputPointers?: Readonly<Record<string, string>>
  /** Only a registered literal option of a merged tool may enter an audit record. */
  auditOption?: (args: Record<string, unknown>) => string | null
  /** Declares the result shape published as `outputSchema` and validated before it is returned. */
  outputSchema?: ToolOutputSchema
  [field: string]: unknown
}

/** The function-tool declaration handed to a model or published through MCP discovery. */
export type McpToolSchema = {
  name: string
  type: 'function'
  description?: string | null
  parameters: Record<string, unknown> | null
  /** `true` enables strict JSON schema validation; `null` leaves provider strict mode unset. */
  strict: true | null
}

/** A tool: a declaration plus a handler curried over the calling user. */
export type McpTool<
  TUser = unknown,
  TContext = unknown,
  TArgs = unknown,
  TResult = unknown,
  TCurry extends readonly unknown[] = readonly [],
> = {
  schema: McpToolSchema
  function: (
    user: TUser,
    ...curry: TCurry
  ) => (args: TArgs, context?: TContext) => Promise<TResult> | TResult
  roles?: Partial<Record<string, boolean>>
  meta?: McpToolMeta
}
