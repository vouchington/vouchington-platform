import { invalidResponse as invalid, isRecord } from './errors.mts'
import type {
  StructuredDecisionAnswer,
  StructuredDecisionNativeAnswer,
  StructuredDecisionQuestion,
} from './types.mts'

const TOLERANCE = 0.0001

function probability(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1) {
    invalid('Provider probability must be a finite value from zero through one.')
  }
  return value
}

function probabilities(raw: unknown, keys: readonly string[]): Readonly<Record<string, number>> {
  if (
    !isRecord(raw) ||
    Object.keys(raw).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(raw, key))
  ) {
    invalid('Provider probabilities do not match requested criteria.')
  }
  const result = Object.fromEntries(keys.map((key) => [key, probability(raw[key])])) as Record<
    string,
    number
  >
  if (Math.abs(Object.values(result).reduce((sum, value) => sum + value, 0) - 1) > TOLERANCE) {
    invalid('Provider probabilities must sum to one.')
  }
  return result
}

function scoreLegend(raw: unknown, expected: readonly string[]): string[] {
  if (isRecord(raw) && Object.keys(raw).length !== expected.length) {
    invalid('Provider score legend does not match the requested criteria.')
  }
  const legend = Array.isArray(raw)
    ? raw
    : isRecord(raw)
      ? expected.map((_, index) => raw[String(index)])
      : []
  if (
    legend.length !== expected.length ||
    legend.some((value, index) => value !== expected[index])
  ) {
    invalid('Provider score legend does not match the requested criteria.')
  }
  return legend as string[]
}

/** Strictly decodes one provider answer against its question; throws `invalid-response`. */
export function decodeAnswer(
  raw: unknown,
  question: StructuredDecisionQuestion,
  answerId: string,
): StructuredDecisionAnswer {
  if (
    !isRecord(raw) ||
    answerId !== question.id ||
    (typeof raw.id === 'string' && raw.id !== answerId) ||
    raw.type !== question.type
  ) {
    invalid('Provider answer type does not match the requested question.')
  }
  const native = raw as StructuredDecisionNativeAnswer
  if (question.type === 'noul') {
    return { id: question.id, type: 'noul', probability: probability(raw.noul), raw: native }
  }
  const confidence = probability(raw.confidence)
  if (question.type === 'choice') {
    if (typeof raw.choice !== 'string' || !question.criteria.includes(raw.choice)) {
      invalid('Provider choice is not one of the requested criteria.')
    }
    return {
      id: question.id,
      type: 'choice',
      choice: raw.choice,
      confidence,
      probabilities: probabilities(raw.probabilities, question.criteria),
      raw: native,
    }
  }
  if (
    typeof raw.score !== 'number' ||
    !Number.isFinite(raw.score) ||
    raw.score < 0 ||
    raw.score > question.criteria.length - 1
  ) {
    invalid('Provider score answer is invalid.')
  }
  const legend = scoreLegend(
    raw.legend,
    question.criteria.map((criterion) => criterion.description),
  )
  const rawProbabilities = raw.probabilities
  const keys =
    isRecord(rawProbabilities) && legend.every((key) => Object.hasOwn(rawProbabilities, key))
      ? legend
      : legend.map((_, index) => String(index))
  return {
    id: question.id,
    type: 'score',
    score: raw.score,
    confidence,
    legend,
    probabilities: probabilities(rawProbabilities, keys),
    raw: native,
  }
}
