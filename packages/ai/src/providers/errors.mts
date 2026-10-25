import Anthropic from '@anthropic-ai/sdk'
import { isAmbiguousBilledHttpStatus, parseRetryAfter, readHeader } from './http.mts'
import type { BilledModelResponse } from './types.mts'

export type ModelProviderErrorCode =
  | 'client-unavailable'
  | 'credit-balance-too-low'
  | 'rate-limited'
  | 'overloaded'
  | 'server-error'
  | 'connection'
  | 'authentication'
  | 'permission'
  | 'invalid-request'
  | 'unsupported-parameter'
  | 'invalid-response'
  | 'refusal'
  | 'output-truncated'

/** The one classification every provider and transport failure maps onto. */
export type ModelProviderRetryClass = 'transient' | 'permanent'

export type ModelProviderErrorOptions = {
  retryClass: ModelProviderRetryClass
  status?: number
  retryAfterMs?: number
  ambiguousBilled?: boolean
  billedResponse?: BilledModelResponse
  cause?: unknown
}

/** Brand shared by every copy of this package, so errors are recognized across module copies. */
export const MODEL_PROVIDER_ERROR_BRAND = Symbol.for('@vouchington/ai/ModelProviderError')

/**
 * Recognizes a `ModelProviderError` from this or any other installed copy of the package (for
 * example the two copies pnpm creates for different optional-peer contexts).
 */
export function isModelProviderError(value: unknown): value is ModelProviderError {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[MODEL_PROVIDER_ERROR_BRAND] === true
  )
}

/**
 * A classified provider failure. Whether and when to retry is the caller's decision. `instanceof`
 * works across package copies because it checks the shared brand.
 */
export class ModelProviderError extends Error {
  static [Symbol.hasInstance](this: unknown, value: unknown): boolean {
    // Only the base class uses the shared brand; subclasses keep prototype-based checks.
    if (this !== ModelProviderError) {
      return Function.prototype[Symbol.hasInstance].call(this, value)
    }
    return isModelProviderError(value)
  }

  readonly [MODEL_PROVIDER_ERROR_BRAND] = true as const
  readonly code: ModelProviderErrorCode
  readonly retryClass: ModelProviderRetryClass
  readonly status: number | undefined
  /** The provider's `Retry-After`, when it sent one on a transient failure. */
  readonly retryAfterMs: number | undefined
  /** The request was sent but its outcome is unknown, so the provider may have billed it. */
  readonly ambiguousBilled: boolean
  /** Set when the provider answered 2xx and billed the call but the answer is unusable. */
  readonly billedResponse: BilledModelResponse | undefined

  constructor(code: ModelProviderErrorCode, message: string, options: ModelProviderErrorOptions) {
    super(message, { cause: options.cause })
    this.name = 'ModelProviderError'
    this.code = code
    this.retryClass = options.retryClass
    this.status = options.status
    this.retryAfterMs = options.retryAfterMs
    this.ambiguousBilled = options.ambiguousBilled ?? false
    this.billedResponse = options.billedResponse
  }
}

const CREDIT_BALANCE_TOO_LOW = /credit balance is too low/i

function statusCode(status: number, message: string): ModelProviderErrorCode {
  if (status === 429) return 'rate-limited'
  if (status === 529) return 'overloaded'
  if (status >= 500) return 'server-error'
  if (status === 401) return 'authentication'
  if (status === 403) return 'permission'
  if (status === 400 && CREDIT_BALANCE_TOO_LOW.test(message)) return 'credit-balance-too-low'
  return 'invalid-request'
}

/**
 * Maps an Anthropic SDK failure onto the shared classification. 408, 429, 529 and 5xx are
 * transient and carry `retry-after`; a dropped connection is transient; every other 4xx is
 * permanent. An abort is the caller's own, so it and any unrecognized error return unchanged.
 */
export function classifyAnthropicError(error: unknown): unknown {
  if (error instanceof Anthropic.APIUserAbortError) return error
  if (error instanceof Anthropic.APIConnectionError) {
    return new ModelProviderError('connection', 'Anthropic request failed to connect.', {
      retryClass: 'transient',
      ambiguousBilled: true,
      cause: error,
    })
  }
  if (!(error instanceof Anthropic.APIError) || error.status === undefined) return error
  const { status } = error
  const code = statusCode(status, error.message)
  const retryClass = status === 408 || status === 429 || status >= 500 ? 'transient' : 'permanent'
  const retryAfterMs = parseRetryAfter(readHeader(error.headers, 'retry-after'))
  return new ModelProviderError(code, `Anthropic returned HTTP ${status} (${code}).`, {
    retryClass,
    status,
    ...(retryClass === 'transient' && retryAfterMs !== null ? { retryAfterMs } : {}),
    ambiguousBilled: isAmbiguousBilledHttpStatus(status),
    cause: error,
  })
}
