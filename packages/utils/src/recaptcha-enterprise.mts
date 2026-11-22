import {
  asRecord,
  callProviderJson,
  malformedResponse,
  optionalString,
  type ProviderCallOptions,
  type ProviderFailure,
} from './provider-http.mts'

export type { ProviderFailure, ProviderFetch } from './provider-http.mts'

export const RECAPTCHA_ENTERPRISE_ORIGIN = 'https://recaptchaenterprise.googleapis.com'

export type RecaptchaInvalidReason =
  | 'MALFORMED'
  | 'EXPIRED'
  | 'DUPE'
  | 'MISSING'
  | 'BROWSER_ERROR'
  | 'SITE_MISMATCH'
  | 'UNKNOWN'

export interface RecaptchaAssessmentOptions extends ProviderCallOptions {
  projectId: string
  apiKey: string
  siteKey: string
  token: string
  expectedAction: string
  userIpAddress?: string
  /** Overrides {@link RECAPTCHA_ENTERPRISE_ORIGIN}. */
  origin?: string
}

export type RecaptchaAssessmentResult =
  | {
      status: 'assessed'
      /** riskAnalysis.score in [0, 1]. */
      score: number
      /** The action the client claimed when it generated the token. */
      action: string | null
      /** True when `action` equals the expected action. */
      actionMatches: boolean
      /** Coarse riskAnalysis reasons such as AUTOMATION. */
      reasons: readonly string[]
    }
  | {
      /** The token is malformed, expired, spent, or for another site: a user-level outcome. */
      status: 'invalid-token'
      invalidReason: RecaptchaInvalidReason
      action: string | null
    }
  | { status: 'error'; failure: ProviderFailure }

const INVALID_REASONS: ReadonlySet<string> = new Set([
  'MALFORMED',
  'EXPIRED',
  'DUPE',
  'MISSING',
  'BROWSER_ERROR',
  'SITE_MISMATCH',
])
const LABEL = 'reCAPTCHA Enterprise assessment'

/** Creates one assessment and classifies it as scored, invalid token, or provider error. */
export async function assessRecaptchaToken(
  options: RecaptchaAssessmentOptions,
): Promise<RecaptchaAssessmentResult> {
  const event: Record<string, string> = {
    token: options.token,
    siteKey: options.siteKey,
    expectedAction: options.expectedAction,
  }
  if (options.userIpAddress) event.userIpAddress = options.userIpAddress
  const url = new URL(
    `/v1/projects/${encodeURIComponent(options.projectId)}/assessments`,
    options.origin ?? RECAPTCHA_ENTERPRISE_ORIGIN,
  )
  url.searchParams.set('key', options.apiKey)
  const call = await callProviderJson(
    LABEL,
    url.toString(),
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event }),
    },
    options,
  )
  if (!call.ok) return { status: 'error', failure: call.failure }
  return classifyAssessment(call.body, options.expectedAction)
}

function classifyAssessment(body: unknown, expectedAction: string): RecaptchaAssessmentResult {
  const root = asRecord(body)
  const properties = asRecord(root?.tokenProperties)
  if (!properties || typeof properties.valid !== 'boolean') {
    return { status: 'error', failure: malformedResponse(LABEL, 'no tokenProperties.valid') }
  }
  const action = optionalString(properties.action)
  if (!properties.valid) {
    const reason = optionalString(properties.invalidReason) ?? ''
    const invalidReason = INVALID_REASONS.has(reason)
      ? (reason as RecaptchaInvalidReason)
      : 'UNKNOWN'
    return { status: 'invalid-token', invalidReason, action }
  }
  const risk = asRecord(root?.riskAnalysis)
  if (typeof risk?.score !== 'number') {
    return { status: 'error', failure: malformedResponse(LABEL, 'a valid token without a score') }
  }
  const reasons = Array.isArray(risk.reasons)
    ? risk.reasons.filter((reason): reason is string => typeof reason === 'string')
    : []
  return {
    status: 'assessed',
    score: risk.score,
    action,
    actionMatches: action === expectedAction,
    reasons,
  }
}
