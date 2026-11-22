import {
  asRecord,
  callProviderJson,
  malformedResponse,
  optionalString,
  type ProviderCallOptions,
  type ProviderFailure,
} from './provider-http.mts'

export type { ProviderFailure, ProviderFetch } from './provider-http.mts'

export const WEB_RISK_LOOKUP_URL = 'https://webrisk.googleapis.com/v1/uris:search'

export const WEB_RISK_THREAT_TYPES = [
  'MALWARE',
  'SOCIAL_ENGINEERING',
  'UNWANTED_SOFTWARE',
  'SOCIAL_ENGINEERING_EXTENDED_COVERAGE',
] as const

export interface WebRiskLookupOptions extends ProviderCallOptions {
  apiKey: string
  uri: string
  /** Defaults to {@link WEB_RISK_THREAT_TYPES}. */
  threatTypes?: readonly string[]
  /** Overrides {@link WEB_RISK_LOOKUP_URL}. */
  endpoint?: string
  /** Statuses classified as rate limiting. Default 429 and 403 (Google also reports quota as 403). */
  rateLimitStatuses?: readonly number[]
}

export type WebRiskLookupResult =
  | { status: 'clean' }
  | {
      status: 'threat'
      threatTypes: readonly string[]
      /** RFC 3339 time after which the verdict should be re-checked. */
      expireTime: string | null
    }
  | { status: 'error'; failure: ProviderFailure }

const LABEL = 'Web Risk lookup'

/** Looks up one URI. The Lookup API accepts a single `uri` per call. */
export async function lookupWebRiskUri(
  options: WebRiskLookupOptions,
): Promise<WebRiskLookupResult> {
  const url = new URL(options.endpoint ?? WEB_RISK_LOOKUP_URL)
  url.searchParams.set('uri', options.uri)
  url.searchParams.set('key', options.apiKey)
  for (const threatType of options.threatTypes ?? WEB_RISK_THREAT_TYPES) {
    url.searchParams.append('threatTypes', threatType)
  }
  const call = await callProviderJson(
    LABEL,
    url.toString(),
    { method: 'GET' },
    { ...options, rateLimitStatuses: options.rateLimitStatuses ?? [429, 403] },
  )
  if (!call.ok) return { status: 'error', failure: call.failure }
  const root = asRecord(call.body)
  if (!root) return { status: 'error', failure: malformedResponse(LABEL, 'a non-object body') }
  if (root.threat === undefined || root.threat === null) return { status: 'clean' }
  const threat = asRecord(root.threat)
  const types: unknown = threat?.threatTypes
  if (!Array.isArray(types) || types.length === 0 || !types.every((t) => typeof t === 'string')) {
    return { status: 'error', failure: malformedResponse(LABEL, 'a threat without threatTypes') }
  }
  return {
    status: 'threat',
    threatTypes: types as string[],
    expireTime: optionalString(threat?.expireTime),
  }
}
