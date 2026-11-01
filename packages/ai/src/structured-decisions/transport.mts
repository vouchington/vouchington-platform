import { isRecord } from './errors.mts'
import type {
  DecisionTransportRequest,
  StructuredDecisionQuestion,
  StructuredDecisionRequest,
  StructuredDecisionUsage,
} from './types.mts'

export type BuildTransportOptions = {
  url: string
  /** The provider name reported when a response names none. */
  provider: string
  apiKey: string
  model: string
  /** Extra top-level body fields, e.g. provider routing preferences. */
  extraBody?: Record<string, unknown>
}

function toProviderQuestion(question: StructuredDecisionQuestion): Record<string, unknown> {
  if (question.type === 'noul') {
    return { type: 'noul', instructions: question.question, criteria: { false: 'No', true: 'Yes' } }
  }
  if (question.type === 'choice') {
    return {
      type: 'choice',
      instructions: question.question,
      criteria: Object.fromEntries(question.criteria.map((value) => [value, value])),
    }
  }
  return {
    type: 'score',
    instructions: question.question,
    criteria: question.criteria.map((criterion) => criterion.description),
  }
}

/** Builds the POST for a decisions endpoint. URL, model, and routing are injected. */
export function buildDecisionTransportRequest(
  options: BuildTransportOptions,
  request: StructuredDecisionRequest,
): DecisionTransportRequest {
  return {
    url: options.url,
    provider: options.provider,
    headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
    body: {
      ...options.extraBody,
      model: options.model,
      state: request.state,
      questions: Object.fromEntries(
        request.questions.map((question) => [question.id, toProviderQuestion(question)]),
      ),
    },
  }
}

function isTokenCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Reads the billing fields of a 2xx body, or null when `input_tokens`/`output_tokens` are not
 * usable. `cost` is passed through only when numeric; pricing fallbacks are the ledger's concern.
 */
export function parseBilledUsage(raw: unknown): StructuredDecisionUsage | null {
  if (!isRecord(raw) || !isRecord(raw.usage)) return null
  const { input_tokens, output_tokens, cost } = raw.usage
  if (!isTokenCount(input_tokens) || !isTokenCount(output_tokens)) return null
  return { input_tokens, output_tokens, ...(typeof cost === 'number' ? { cost } : {}) }
}
