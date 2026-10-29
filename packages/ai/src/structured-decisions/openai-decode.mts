import { decodeResult, type DecodeResultOptions } from './decode.mts'
import { invalidResponse as invalid, isRecord, StructuredDecisionError } from './errors.mts'
import type {
  StructuredDecisionAnswer,
  StructuredDecisionNativeAnswer,
  StructuredDecisionRequest,
  StructuredDecisionResult,
} from './types.mts'

export type DecodeOpenAIResultOptions = Pick<
  DecodeResultOptions,
  'fallbackProvider' | 'isExpectedModel'
>

function probabilityEntries(raw: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(raw) || raw.some((entry) => !isRecord(entry))) {
    invalid('Provider probabilities must be an array of entries.')
  }
  return raw as Array<Record<string, unknown>>
}

// Null-prototype records keep criteria such as `__proto__` as own keys.
function probabilityRecord(): Record<string, unknown> {
  return Object.create(null) as Record<string, unknown>
}

function choiceProbabilities(raw: unknown): Record<string, unknown> {
  const result = probabilityRecord()
  for (const { value, probability } of probabilityEntries(raw)) {
    if (typeof value !== 'string' || Object.hasOwn(result, value)) {
      invalid('Provider choice probabilities contain an invalid or duplicate value.')
    }
    result[value] = probability
  }
  return result
}

/** Score entries carry their level index; they come back as a lowest-to-highest legend. */
function scoreProbabilities(raw: unknown): {
  legend: string[]
  probabilities: Record<string, unknown>
} {
  const entries = probabilityEntries(raw)
  const legend: string[] = []
  const probabilities = probabilityRecord()
  for (const { value, label, probability } of entries) {
    if (
      typeof value !== 'number' ||
      !Number.isInteger(value) ||
      value < 0 ||
      value >= entries.length ||
      legend[value] !== undefined ||
      typeof label !== 'string'
    ) {
      invalid('Provider score probabilities contain an invalid or duplicate level.')
    }
    legend[value] = label
    probabilities[label] = probability
  }
  return { legend, probabilities }
}

/** Maps one OpenAI answer onto the shape `decodeAnswer` reads. */
function adaptAnswer(answer: unknown): Record<string, unknown> {
  if (!isRecord(answer) || typeof answer.name !== 'string') {
    invalid('Provider response contains an answer without a name.')
  }
  const base = { id: answer.name }
  if (answer.type === 'refusal') {
    throw new StructuredDecisionError(
      'invalid-response',
      'Provider refused to answer a question.',
      undefined,
      { failure: { retryClass: 'permanent' } },
    )
  }
  if (answer.type === 'predicate') return { ...base, type: 'noul', noul: answer.probability }
  if (answer.type === 'choice') {
    return {
      ...base,
      type: 'choice',
      choice: answer.choice,
      confidence: answer.confidence,
      probabilities: choiceProbabilities(answer.probabilities),
    }
  }
  if (answer.type === 'score') {
    return {
      ...base,
      type: 'score',
      // A probability-weighted average of level indices, so it may fall between levels.
      score: answer.score,
      confidence: answer.confidence,
      ...scoreProbabilities(answer.probabilities),
    }
  }
  return invalid('Provider answer has an unknown type.')
}

/**
 * Strictly decodes an OpenAI `/v1/decisions` body against the request: every question answered
 * exactly once by name, answers matching their question types, and a refusal rejected as a
 * permanent `invalid-response`. The served model is checked by a caller-injected predicate.
 */
export function decodeOpenAIResult(
  raw: unknown,
  request: StructuredDecisionRequest,
  options: DecodeOpenAIResultOptions,
): StructuredDecisionResult {
  if (!isRecord(raw) || !Array.isArray(raw.answers)) {
    invalid('Provider response does not contain answers.')
  }
  const natives = new Map<string, StructuredDecisionNativeAnswer>()
  const adapted = raw.answers.map((answer) => {
    const mapped = adaptAnswer(answer)
    natives.set(mapped.id as string, answer as StructuredDecisionNativeAnswer)
    return mapped
  })
  const result = decodeResult({ ...raw, answers: adapted }, request, options)
  return {
    ...result,
    raw,
    answers: result.answers.map((answer): StructuredDecisionAnswer => ({
      ...answer,
      raw: natives.get(answer.id)!,
    })),
  }
}
