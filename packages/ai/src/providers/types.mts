/** Provider-neutral token usage. `inputTokens` counts the whole prompt, including cache reads and writes. */
export type ModelUsage = {
  inputTokens: number
  cacheReadTokens: number
  /** Cache writes at the provider's default (5-minute) retention. */
  cacheWrite5mTokens: number
  cacheWrite1hTokens: number
  /** Includes the reasoning tokens. */
  outputTokens: number
  reasoningOutputTokens: number
  /** The provider-reported USD cost for the call (e.g. OpenRouter `usage.cost`), when present. */
  reportedCostUsd?: number
}

export type JsonSchema = Record<string, unknown>

/** The provider and model a caller selected. Both are plain strings the application owns. */
export type ModelSelection = { provider: string; model: string }

export type GenerateJsonRequest<T> = {
  instructions: string
  input: string
  /** The name the schema is registered under at providers that need one. */
  schemaName: string
  schema: JsonSchema
  /** Narrows the schema-valid JSON into the caller's type; throws when it does not fit. */
  parse: (value: unknown) => T
  maxOutputTokens: number
  /** An opaque, stable identifier for the end user, for provider abuse monitoring. */
  safetyIdentifier?: string
  /** A stable prefix key that improves prompt-cache hits at providers that take one. */
  promptCacheKey?: string
  /** Tolerates the slower, cheaper flex tier where a provider has one. */
  flex?: boolean
  maxRetries?: number
  temperature?: number
  topP?: number
  topK?: number
}

/** One provider response that was billed, with everything a usage ledger needs. */
export type BilledModelResponse = {
  provider: string
  /** How the call reached the provider (e.g. `direct`, `openrouter`); an application label. */
  transport: string
  /** The model the provider says it served (a dated snapshot, not necessarily the alias). */
  model: string
  responseId: string
  serviceTier: string
  usage: ModelUsage
}

export type ModelCallResult<T> = BilledModelResponse & { output: T }
