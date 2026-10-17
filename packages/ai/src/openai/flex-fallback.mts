import {
  isOpenAIFlexCapacityFailedResponseError,
  isOpenAIFlexResourceUnavailableError,
} from './classify.mts'

export type OpenAIFlexFallbackTrigger = 'http_429' | 'stream_failed'

export type OpenAIFlexFallback<P> = { params: P; trigger: OpenAIFlexFallbackTrigger }

/**
 * Decides whether a failed `service_tier: 'flex'` request should be resent once on the default
 * tier, and builds the resend params. Both triggers are positively unbilled, so the resend cannot
 * double-bill. Returns null for non-flex requests and every other error. Whether to resend (and
 * rechecking spend caps first) stays with the caller:
 *
 * ```ts
 * try { return await send(params) } catch (err) {
 *   const fallback = getOpenAIFlexFallback(params, err)
 *   if (!fallback) throw err
 *   return send(fallback.params)
 * }
 * ```
 */
export function getOpenAIFlexFallback<P extends { service_tier?: string | null }>(
  params: P,
  error: unknown,
): OpenAIFlexFallback<P> | null {
  if (params.service_tier !== 'flex') return null
  const trigger: OpenAIFlexFallbackTrigger | null = isOpenAIFlexResourceUnavailableError(error)
    ? 'http_429'
    : isOpenAIFlexCapacityFailedResponseError(error)
      ? 'stream_failed'
      : null
  return trigger ? { params: { ...params, service_tier: 'default' }, trigger } : null
}

/** OpenRouter model ids are `vendor/model`; bare OpenAI model names get the `openai/` prefix. */
export function toOpenRouterModel(model: string): string {
  return model.includes('/') ? model : `openai/${model}`
}
