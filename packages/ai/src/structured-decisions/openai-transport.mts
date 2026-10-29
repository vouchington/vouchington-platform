import { StructuredDecisionError } from './errors.mts'
import type {
  DecisionTransportRequest,
  StructuredDecisionQuestion,
  StructuredDecisionRequest,
} from './types.mts'
import { validateRequest } from './validation.mts'

const MAX_QUESTIONS = 400
const MAX_SCORE_LEVELS = 10

export type BuildOpenAIRequestOptions = {
  url: string
  apiKey: string
  model: string
}

function invalid(message: string): never {
  throw new StructuredDecisionError('invalid-request', message)
}

function toOpenAIQuestion(question: StructuredDecisionQuestion): Record<string, unknown> {
  const base = { name: question.id, instructions: question.question }
  if (question.type === 'noul') return { ...base, type: 'predicate' }
  if (question.type === 'choice') {
    return {
      ...base,
      type: 'choice',
      choices: question.criteria.map((value) => ({ value, description: value })),
    }
  }
  if (question.criteria.length > MAX_SCORE_LEVELS) {
    invalid(`Score questions allow at most ${MAX_SCORE_LEVELS} levels.`)
  }
  return {
    ...base,
    type: 'score',
    levels: question.criteria.map(({ description }) => ({ label: description, description })),
  }
}

/**
 * Builds the POST for an OpenAI `/v1/decisions` endpoint. URL and model are injected. Throws
 * `invalid-request` for a malformed request, more than 400 questions, or a score over 10 levels.
 */
export function buildOpenAIDecisionRequest(
  options: BuildOpenAIRequestOptions,
  request: StructuredDecisionRequest,
): DecisionTransportRequest {
  validateRequest(request)
  if (request.questions.length > MAX_QUESTIONS) {
    invalid(`At most ${MAX_QUESTIONS} questions are allowed.`)
  }
  return {
    url: options.url,
    provider: 'OpenAI',
    headers: { authorization: `Bearer ${options.apiKey}`, 'content-type': 'application/json' },
    body: {
      model: options.model,
      input: request.state,
      questions: request.questions.map(toOpenAIQuestion),
    },
  }
}
