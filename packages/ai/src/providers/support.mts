import { ModelProviderError } from './errors.mts'
import { isPricedModel, normalizeModelAlias, type PriceTable } from './pricing.mts'
import type { GenerateJsonRequest, ModelSelection } from './types.mts'

export type SupportPolicy = {
  prices: PriceTable
  /** `provider:alias` keys of models that 400 on any non-default `temperature`, `top_p` or `top_k`. */
  rejectsSamplingParameters?: ReadonlySet<string>
}

function unsupported(message: string): ModelProviderError {
  return new ModelProviderError('unsupported-parameter', message, { retryClass: 'permanent' })
}

/**
 * Rejects what a model cannot take before any request is sent, so a bad configuration fails fast
 * and unbilled. An unpriced model is rejected too: its calls would be recorded unpriced.
 */
export function assertSupportedRequest(
  selection: ModelSelection,
  request: Pick<GenerateJsonRequest<unknown>, 'temperature' | 'topP' | 'topK'>,
  policy: SupportPolicy,
): void {
  if (!isPricedModel(policy.prices, selection.provider, selection.model)) {
    throw unsupported(`${selection.provider} model '${selection.model}' has no price row.`)
  }
  const key = `${selection.provider}:${normalizeModelAlias(selection.model)}`
  if (!policy.rejectsSamplingParameters?.has(key)) return
  if (
    request.temperature !== undefined ||
    request.topP !== undefined ||
    request.topK !== undefined
  ) {
    throw unsupported(`${selection.model} does not accept temperature, top_p or top_k.`)
  }
}
