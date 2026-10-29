import { parseRetryAfter, readHeader } from '../providers/http.mts'
import type {
  ProviderErrorDetail,
  StructuredDecisionProviderFailure,
  StructuredDecisionRetryClass,
} from './types.mts'

/** Decides whether a failure is worth retrying. No status means no response (a connection failure). */
export type ClassifyFailure = (
  status: number | undefined,
  detail: ProviderErrorDetail | undefined,
) => StructuredDecisionRetryClass

const OPENROUTER_IN_FLIGHT_BUDGET = 'openrouter_in_flight_budget'

function statusOnly(status: number): StructuredDecisionRetryClass {
  return status === 408 || status === 429 || status >= 500 ? 'transient' : 'permanent'
}

/** Classifies by HTTP status alone: 408, 429 and 5xx are transient; no response is transient. */
export const classifyByStatus: ClassifyFailure = (status) =>
  status === undefined ? 'transient' : statusOnly(status)

/**
 * OpenRouter (https://openrouter.ai/docs/api-reference/errors): an outage can answer 403, so a
 * bare 403 is transient and only a moderation flag or guardrail block makes it permanent. 402 is
 * permanent unless it is the in-flight budget limit. 400 and 401 are permanent; 408, 429, 502 and
 * 503 are transient; every other status falls back to the status-only rule.
 */
export const classifyOpenRouterFailure: ClassifyFailure = (status, detail) => {
  if (status === 402) {
    return detail?.limitSource === OPENROUTER_IN_FLIGHT_BUDGET ? 'transient' : 'permanent'
  }
  if (status === 403) return detail?.moderation || detail?.guardrail ? 'permanent' : 'transient'
  return classifyByStatus(status, detail)
}

/**
 * OpenAI: 408, 409, 429 and 5xx are transient, as is no response; every other status is
 * permanent.
 */
export const classifyOpenAIFailure: ClassifyFailure = (status, detail) =>
  status === 409 ? 'transient' : classifyByStatus(status, detail)

/** The classified failure of a non-2xx response, with its `Retry-After` when it is retryable. */
export function classifyProviderResponse(
  classify: ClassifyFailure,
  response: { status: number; headers: unknown },
  detail: ProviderErrorDetail | undefined,
): StructuredDecisionProviderFailure {
  const retryClass = classify(response.status, detail)
  const retryAfterMs = parseRetryAfter(readHeader(response.headers, 'retry-after'))
  return {
    retryClass,
    ...(retryClass === 'transient' && retryAfterMs !== null ? { retryAfterMs } : {}),
    ...(detail ? { detail } : {}),
  }
}
