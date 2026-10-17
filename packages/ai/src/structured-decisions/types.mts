export type NoulQuestion = { id: string; type: 'noul'; question: string }
export type ChoiceQuestion = {
  id: string
  type: 'choice'
  question: string
  criteria: readonly string[]
}
export type ScoreCriterion = { description: string; value: number }
export type ScoreQuestion = {
  id: string
  type: 'score'
  question: string
  criteria: readonly ScoreCriterion[]
}
export type StructuredDecisionQuestion = NoulQuestion | ChoiceQuestion | ScoreQuestion
export type StructuredDecisionRequest = {
  state: string
  questions: readonly StructuredDecisionQuestion[]
}
export type StructuredDecisionNativeAnswer = Readonly<Record<string, unknown>>
export type NoulAnswer = {
  id: string
  type: 'noul'
  probability: number
  raw: StructuredDecisionNativeAnswer
}
export type ChoiceAnswer = {
  id: string
  type: 'choice'
  choice: string
  confidence: number
  probabilities: Readonly<Record<string, number>>
  raw: StructuredDecisionNativeAnswer
}
export type ScoreAnswer = {
  id: string
  type: 'score'
  score: number
  confidence: number
  legend: readonly string[]
  probabilities: Readonly<Record<string, number>>
  raw: StructuredDecisionNativeAnswer
}
export type StructuredDecisionAnswer = NoulAnswer | ChoiceAnswer | ScoreAnswer
export type StructuredDecisionResult = {
  answers: readonly StructuredDecisionAnswer[]
  model: string
  provider: string
  raw: unknown
  usage: Readonly<Record<string, unknown>> | null
}

/** Whether the same request may succeed later (`transient`) or never will (`permanent`). */
export type StructuredDecisionRetryClass = 'transient' | 'permanent'

/**
 * What a provider's error body says, bounded and free of echoed user content. `flagged_input` and
 * every metadata value outside the named keys are dropped before anything is kept.
 */
export type ProviderErrorDetail = {
  code?: number | string
  providerMessage?: string
  errorType?: string
  providerCode?: string
  reasons?: readonly string[]
  providerName?: string
  modelSlug?: string
  limitSource?: string
  /** The provider's content-moderation flag fired (`reasons` or `flagged_input` was present). */
  moderation: boolean
  /** The provider's guardrail block fired (`patterns` was present). */
  guardrail: boolean
}

export type StructuredDecisionProviderFailure = {
  retryClass: StructuredDecisionRetryClass
  /** Honoured from `Retry-After`, in milliseconds. */
  retryAfterMs?: number
  detail?: ProviderErrorDetail
}

/** The billing fields of a 2xx body worth recording; `cost` is passed through when numeric. */
export type StructuredDecisionUsage = {
  input_tokens: number
  output_tokens: number
  cost?: number
}

/** A prepared HTTP request; the application sends it with its own fetch. */
export type DecisionTransportRequest = {
  url: string
  provider: string
  headers: Record<string, string>
  body: Record<string, unknown>
}
