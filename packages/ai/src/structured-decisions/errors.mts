import type {
  ProviderErrorDetail,
  StructuredDecisionProviderFailure,
  StructuredDecisionRetryClass,
} from './types.mts'

export type StructuredDecisionErrorCode = 'invalid-request' | 'invalid-response' | 'provider-error'

export class StructuredDecisionError extends Error {
  readonly code: StructuredDecisionErrorCode
  readonly status: number | undefined
  /** Set on every `provider-error`: the retry classification and the safe error detail. */
  readonly retryClass: StructuredDecisionRetryClass | undefined
  readonly retryAfterMs: number | undefined
  readonly detail: ProviderErrorDetail | undefined

  constructor(
    code: StructuredDecisionErrorCode,
    message: string,
    status?: number,
    options?: ErrorOptions & { failure?: StructuredDecisionProviderFailure },
  ) {
    super(message, options)
    this.name = 'StructuredDecisionError'
    this.code = code
    this.status = status
    this.retryClass = options?.failure?.retryClass
    this.retryAfterMs = options?.failure?.retryAfterMs
    this.detail = options?.failure?.detail
  }
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function invalidResponse(message: string): never {
  throw new StructuredDecisionError('invalid-response', message)
}
