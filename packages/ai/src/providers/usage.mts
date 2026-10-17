import type { ModelUsage } from './types.mts'

/** The fields of an Anthropic Messages `usage` object this package reads. */
export type AnthropicUsageLike = {
  input_tokens: number
  output_tokens: number
  cache_creation_input_tokens?: number | null
  cache_read_input_tokens?: number | null
  cache_creation?: {
    ephemeral_5m_input_tokens: number
    ephemeral_1h_input_tokens: number
  } | null
  output_tokens_details?: { thinking_tokens: number } | null
}

/** The fields of an OpenAI Responses (or OpenRouter) `usage` object this package reads. */
export type OpenAIUsageLike = {
  input_tokens: number
  output_tokens: number
  input_tokens_details?: { cached_tokens?: number; cache_write_tokens?: number } | null
  output_tokens_details?: { reasoning_tokens?: number } | null
  cost?: number
}

function clamp(value: number | null | undefined, max: number): number {
  return Math.min(max, Math.max(0, value ?? 0))
}

/**
 * Anthropic reports `input_tokens` as the uncached remainder; the cache reads and writes are
 * separate. The normalized `inputTokens` is the whole prompt.
 */
export function anthropicUsageToModelUsage(usage: AnthropicUsageLike): ModelUsage {
  const cacheRead = Math.max(0, usage.cache_read_input_tokens ?? 0)
  const write5m = Math.max(
    0,
    usage.cache_creation
      ? usage.cache_creation.ephemeral_5m_input_tokens
      : (usage.cache_creation_input_tokens ?? 0),
  )
  const write1h = Math.max(0, usage.cache_creation?.ephemeral_1h_input_tokens ?? 0)
  const outputTokens = Math.max(0, usage.output_tokens)
  return {
    inputTokens: Math.max(0, usage.input_tokens) + cacheRead + write5m + write1h,
    cacheReadTokens: cacheRead,
    cacheWrite5mTokens: write5m,
    cacheWrite1hTokens: write1h,
    outputTokens,
    reasoningOutputTokens: clamp(usage.output_tokens_details?.thinking_tokens, outputTokens),
  }
}

/**
 * OpenAI's `input_tokens` already includes the cached and cache-written tokens. Counts are clamped
 * so a stored row's cost is always reproducible from its stored inputs. OpenAI reports one
 * cache-write count with no retention split; it is kept in the 5-minute dimension.
 */
export function openAIUsageToModelUsage(usage: OpenAIUsageLike): ModelUsage {
  const inputTokens = Math.max(0, usage.input_tokens)
  const cacheRead = clamp(usage.input_tokens_details?.cached_tokens, inputTokens)
  const cacheWrite = clamp(usage.input_tokens_details?.cache_write_tokens, inputTokens - cacheRead)
  const outputTokens = Math.max(0, usage.output_tokens)
  return {
    inputTokens,
    cacheReadTokens: cacheRead,
    cacheWrite5mTokens: cacheWrite,
    cacheWrite1hTokens: 0,
    outputTokens,
    reasoningOutputTokens: clamp(usage.output_tokens_details?.reasoning_tokens, outputTokens),
    ...(usage.cost === undefined ? {} : { reportedCostUsd: usage.cost }),
  }
}
