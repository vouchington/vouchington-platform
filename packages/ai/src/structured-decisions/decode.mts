import { decodeAnswer } from './answer-decoder.mts'
import { invalidResponse as invalid, isRecord } from './errors.mts'
import type { StructuredDecisionRequest, StructuredDecisionResult } from './types.mts'

export type DecodeResultOptions = {
  /** Provider name used when the body names none. */
  fallbackProvider: string
  /** Rejects a body served by a model the application did not expect. Defaults to any model. */
  isExpectedModel?: (model: string) => boolean
  /** Rejects a body from an unexpected provider name. Defaults to any provider. */
  isExpectedProvider?: (provider: unknown) => boolean
}

function answerEntries(raw: unknown): Array<[string, unknown]> {
  if (Array.isArray(raw)) {
    return raw.map((answer) => {
      if (!isRecord(answer) || typeof answer.id !== 'string') {
        invalid('Provider response contains an answer without an ID.')
      }
      return [answer.id, answer]
    })
  }
  if (isRecord(raw)) return Object.entries(raw)
  return invalid('Provider response does not contain answers.')
}

/**
 * Strictly decodes a provider body against the request: every question answered exactly once,
 * answers matching their question types, and (optionally) the served model and provider checked
 * by caller-injected predicates.
 */
export function decodeResult(
  raw: unknown,
  request: StructuredDecisionRequest,
  options: DecodeResultOptions,
): StructuredDecisionResult {
  if (!isRecord(raw) || typeof raw.model !== 'string') {
    invalid('Provider response does not contain a valid decision envelope.')
  }
  if (options.isExpectedModel && !options.isExpectedModel(raw.model)) {
    invalid('Provider response came from an unexpected model.')
  }
  if (options.isExpectedProvider && !options.isExpectedProvider(raw.provider)) {
    invalid('Provider response came from an unexpected provider.')
  }
  const answers = new Map<string, unknown>()
  for (const [id, answer] of answerEntries(raw.answers)) {
    if (!isRecord(answer) || answers.has(id)) {
      invalid('Provider response contains invalid or duplicate answer IDs.')
    }
    answers.set(id, answer)
  }
  if (answers.size !== request.questions.length) {
    invalid('Provider response does not cover every requested question exactly once.')
  }
  return {
    answers: request.questions.map((question) =>
      decodeAnswer(answers.get(question.id), question, question.id),
    ),
    model: raw.model,
    provider: typeof raw.provider === 'string' ? raw.provider : options.fallbackProvider,
    raw,
    usage: isRecord(raw.usage) ? raw.usage : null,
  }
}
