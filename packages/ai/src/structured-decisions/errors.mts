import { brandedHasInstance, hasBrand } from '../providers/brand.mts'
import type {
  ProviderErrorDetail,
  StructuredDecisionProviderFailure,
  StructuredDecisionRetryClass,
} from './types.mts'

export type StructuredDecisionErrorCode = 'invalid-request' | 'invalid-response' | 'provider-error'

/** Brand shared by every copy of this package, so errors are recognized across module copies. */
export const STRUCTURED_DECISION_ERROR_BRAND = Symbol.for('@vouchington/ai/StructuredDecisionError')

/** Recognizes a `StructuredDecisionError` from this or any other installed copy of the package. */
export function isStructuredDecisionError(value: unknown): value is StructuredDecisionError {
  return hasBrand(value, STRUCTURED_DECISION_ERROR_BRAND)
}

/** `instanceof` works across package copies because it checks the shared brand. */
export class StructuredDecisionError extends Error {
  static [Symbol.hasInstance](this: unknown, value: unknown): boolean {
    return brandedHasInstance(StructuredDecisionError, STRUCTURED_DECISION_ERROR_BRAND, this, value)
  }

  readonly [STRUCTURED_DECISION_ERROR_BRAND] = true as const
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
