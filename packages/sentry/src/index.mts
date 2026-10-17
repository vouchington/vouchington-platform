export { captureError, type CaptureOptions } from './capture.mts'
export { createCodedError, type CodedError } from './coded-error.mts'
export {
  CLIENT_IP_HEADER_NAMES,
  createDataCollectionPolicy,
  type DataCollectionOptions,
} from './data-collection.mts'
export { createEventFilter, type EventFilterOptions } from './event-filter.mts'
export {
  HttpNoBodyError,
  HttpRateLimitError,
  HttpResponseSizeError,
  HttpServerError,
} from './http-errors.mts'
export { createSentryInitOptions, type CreateSentryInitOptionsInput } from './init-options.mts'
export { createSpanScrubber } from './scrub.mts'
export {
  withSpikeProtection,
  type SpikeProtectableEvent,
  type SpikeProtectionOptions,
} from './spike-protection.mts'
export type { CaptureClient, FlushClient, SentryInitOptions } from './types.mts'
