import {
  asRecord,
  callProviderJson,
  malformedResponse,
  optionalString,
  providerFailure,
  type ProviderCallOptions,
  type ProviderFailure,
} from './provider-http.mts'

export type { ProviderFailure, ProviderFetch } from './provider-http.mts'

export const TURNSTILE_SITEVERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify'

/** Cloudflare's documented test secrets: always passes, always fails, token already spent. */
export const TURNSTILE_TEST_SECRET_KEYS = Object.freeze({
  alwaysPasses: '1x0000000000000000000000000000000AA',
  alwaysFails: '2x0000000000000000000000000000000AA',
  tokenAlreadySpent: '3x0000000000000000000000000000000AA',
})

export type TurnstileErrorCode =
  | 'missing-input-secret'
  | 'invalid-input-secret'
  | 'missing-input-response'
  | 'invalid-input-response'
  | 'bad-request'
  | 'timeout-or-duplicate'
  | 'internal-error'

export type TurnstileRejectionReason =
  | 'missing-token'
  | 'invalid-token'
  | 'expired-or-duplicate'
  | 'unclassified'

export interface TurnstileSiteverifyOptions extends ProviderCallOptions {
  secret: string
  token: string
  remoteIp?: string
  /** Lets a retry of the same token return the original verdict instead of `timeout-or-duplicate`. */
  idempotencyKey?: string
  /** Overrides {@link TURNSTILE_SITEVERIFY_URL}. */
  endpoint?: string
}

export interface TurnstileVerdict {
  hostname: string | null
  action: string | null
  cdata: string | null
  challengeTs: string | null
  /** True when Cloudflare marks the verdict as produced by a testing secret. */
  resultWithTestingKey: boolean
}

export type TurnstileResult =
  | ({ status: 'success' } & TurnstileVerdict)
  | {
      /** The token itself failed verification: a user-level outcome, not a provider fault. */
      status: 'rejected'
      reason: TurnstileRejectionReason
      /** Raw provider codes; documented ones are listed in {@link TurnstileErrorCode}. */
      errorCodes: readonly string[]
    }
  | { status: 'error'; failure: ProviderFailure; errorCodes: readonly string[] }

const REJECTION_BY_CODE: Record<string, TurnstileRejectionReason> = {
  'missing-input-response': 'missing-token',
  'invalid-input-response': 'invalid-token',
  'timeout-or-duplicate': 'expired-or-duplicate',
}
const CONFIGURATION_CODES = new Set(['missing-input-secret', 'invalid-input-secret', 'bad-request'])
const LABEL = 'Turnstile siteverify'

/** Calls siteverify once and classifies the answer as success, rejection, or provider error. */
export async function verifyTurnstileToken(
  options: TurnstileSiteverifyOptions,
): Promise<TurnstileResult> {
  const params = new URLSearchParams({ secret: options.secret, response: options.token })
  if (options.remoteIp) params.set('remoteip', options.remoteIp)
  if (options.idempotencyKey) params.set('idempotency_key', options.idempotencyKey)
  const call = await callProviderJson(
    LABEL,
    options.endpoint ?? TURNSTILE_SITEVERIFY_URL,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
    },
    options,
  )
  if (!call.ok) return { status: 'error', failure: call.failure, errorCodes: [] }
  return classifyTurnstileBody(call.body)
}

function classifyTurnstileBody(body: unknown): TurnstileResult {
  const root = asRecord(body)
  if (!root || typeof root.success !== 'boolean') {
    return {
      status: 'error',
      failure: malformedResponse(LABEL, 'a body without a boolean success'),
      errorCodes: [],
    }
  }
  if (root.success) {
    return {
      status: 'success',
      hostname: optionalString(root.hostname),
      action: optionalString(root.action),
      cdata: optionalString(root.cdata),
      challengeTs: optionalString(root.challenge_ts),
      resultWithTestingKey: asRecord(root.metadata)?.result_with_testing_key === true,
    }
  }
  const raw = root['error-codes']
  const errorCodes = Array.isArray(raw)
    ? raw.filter((code): code is string => typeof code === 'string')
    : []
  const configCode = errorCodes.find((code) => CONFIGURATION_CODES.has(code))
  if (configCode) {
    const message = `${LABEL} rejected the request: ${configCode}`
    return {
      status: 'error',
      failure: providerFailure('configuration', false, message),
      errorCodes,
    }
  }
  if (errorCodes.includes('internal-error')) {
    const failure = providerFailure('http', true, `${LABEL} reported internal-error`)
    return { status: 'error', failure, errorCodes }
  }
  const reason = errorCodes.map((code) => REJECTION_BY_CODE[code]).find(Boolean) ?? 'unclassified'
  return { status: 'rejected', reason, errorCodes }
}

export interface TurnstileExpectedContext {
  /** Compared exactly. */
  action?: string
  /** Compared case-insensitively. */
  hostname?: string
}

export interface TurnstileContextMismatch {
  field: 'action' | 'hostname'
  expected: string
  received: string | null
}

/** Lists the verdict fields that differ from what the caller expected. Empty means a match. */
export function findTurnstileContextMismatches(
  verdict: Pick<TurnstileVerdict, 'action' | 'hostname'>,
  expected: TurnstileExpectedContext,
): TurnstileContextMismatch[] {
  const mismatches: TurnstileContextMismatch[] = []
  if (expected.action !== undefined && verdict.action !== expected.action) {
    mismatches.push({ field: 'action', expected: expected.action, received: verdict.action })
  }
  if (
    expected.hostname !== undefined &&
    verdict.hostname?.toLowerCase() !== expected.hostname.toLowerCase()
  ) {
    mismatches.push({ field: 'hostname', expected: expected.hostname, received: verdict.hostname })
  }
  return mismatches
}

/** Returns the first non-empty trimmed string among `fieldNames` of a parsed request body. */
export function extractTurnstileToken(
  body: unknown,
  fieldNames: readonly string[] = ['cf_turnstile_response'],
): string | undefined {
  const fields = asRecord(body)
  if (!fields) return undefined
  for (const name of fieldNames) {
    const value = fields[name]
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return undefined
}
