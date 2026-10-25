export { SENSITIVE_VALUE } from './observability-records.mts'
export {
  createSpikeWindowTracker,
  DEFAULT_MAX_SPIKE_FINGERPRINTS,
  type SpikeWindowTracker,
} from './spike-window.mts'
export {
  CIRCULAR_VALUE,
  DEFAULT_MAX_DEPTH,
  EMAIL_REDACTED,
  TOKEN_REDACTED,
  redactText,
  scrubDeep,
  type DeepScrubOptions,
} from './observability-deep.mts'
export {
  composeBeforeSend,
  scrubBreadcrumb,
  scrubBreadcrumbs,
  scrubEvent,
  scrubHeaders,
  scrubRequest,
  scrubSpanAttributes,
  type ObservableEvent,
  type ScrubOptions,
} from './observability-event.mts'
export {
  scrubCredentialHeaders,
  scrubRequestCredentialFields,
  scrubSpanCredentialAttributes,
} from './observability-credentials.mts'
export {
  SCRUBBED_URL_ATTRIBUTE_KEYS,
  URL_ATTRIBUTE_KEYS,
  URL_COMPONENT_ATTRIBUTE_KEYS,
  scrubHeaderUrls,
  scrubRequestUrlFields,
  scrubSpanUrlAttributes,
  scrubUrlValue,
  stripUrlQueryAndFragment,
  type UrlScrubOptions,
} from './observability-url.mts'
export {
  REQUEST_BODY_SPAN_ATTRIBUTE,
  dropRequestBody,
  dropSpanRequestBody,
} from './observability-body.mts'

export function isAllowedEnvironment(
  value: string | undefined,
  allowed: readonly string[],
): boolean {
  return value !== undefined && allowed.includes(value)
}

export function shouldReportSpike(count: number, threshold: number): boolean {
  return Number.isFinite(count) && Number.isFinite(threshold) && count >= threshold
}
