import { isRecord, StructuredDecisionError } from './errors.mts'
import type { StructuredDecisionRequest } from './types.mts'

function invalid(message: string): never {
  throw new StructuredDecisionError('invalid-request', message)
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

function validateChoice(raw: unknown): void {
  if (
    !Array.isArray(raw) ||
    raw.length < 2 ||
    raw.some((value) => !nonEmptyString(value)) ||
    new Set(raw).size !== raw.length
  ) {
    invalid('Choice criteria must contain at least two unique non-empty values.')
  }
}

function validateScore(raw: unknown): void {
  if (
    !Array.isArray(raw) ||
    raw.length < 2 ||
    raw.some(
      (criterion, index) =>
        !isRecord(criterion) || criterion.value !== index || !nonEmptyString(criterion.description),
    )
  ) {
    invalid('Score criteria must be consecutive, non-empty levels starting at zero.')
  }
  const descriptions = (raw as Array<{ description: string }>).map(
    (criterion) => criterion.description,
  )
  if (new Set(descriptions).size !== descriptions.length) {
    invalid('Score criterion descriptions must be unique.')
  }
}

/** Throws `StructuredDecisionError('invalid-request')` for a malformed request. */
export function validateRequest(request: StructuredDecisionRequest): void {
  const raw: unknown = request
  if (!isRecord(raw) || !nonEmptyString(raw.state) || !Array.isArray(raw.questions)) {
    invalid('State and a question array are required.')
  }
  if (raw.questions.length === 0) invalid('At least one question is required.')
  const ids = new Set<string>()
  for (const question of raw.questions) {
    if (
      !isRecord(question) ||
      !nonEmptyString(question.id) ||
      !nonEmptyString(question.question) ||
      ids.has(question.id)
    ) {
      invalid('Question IDs and prompts must be unique and non-empty.')
    }
    ids.add(question.id)
    if (question.type === 'choice') validateChoice(question.criteria)
    else if (question.type === 'score') validateScore(question.criteria)
    else if (question.type !== 'noul') invalid('Question type must be noul, choice, or score.')
  }
}
