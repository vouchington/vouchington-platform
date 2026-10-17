import type { ErrorEvent, EventHint } from '@sentry/core'
import {
  composeBeforeSend,
  isAllowedEnvironment,
  type ScrubOptions,
} from '@vouchington/utils/observability'
import { createDataCollectionPolicy } from './data-collection.mts'
import { createEventFilter, type EventFilterOptions } from './event-filter.mts'
import { createSpanScrubber } from './scrub.mts'
import { withSpikeProtection, type SpikeProtectionOptions } from './spike-protection.mts'
import type { SentryInitOptions } from './types.mts'

export interface CreateSentryInitOptionsInput {
  /** Injected DSN. A missing or blank DSN disables the SDK. */
  dsn: string | undefined
  /** Injected deploy environment, for example from `ENVIRONMENT`. */
  environment: string | undefined
  /** Environment names allowed to report. Everything else stays silent (fail closed). */
  enabledEnvironments: readonly string[]
  /** Reported environment when `environment` is unset. Default `development`. */
  fallbackEnvironment?: string
  release?: string | undefined
  /** Left unset by default so the application decides trace sampling. */
  tracesSampleRate?: number
  /** Credential headers and URL redaction applied to events, breadcrumbs, and spans. */
  scrub: ScrubOptions
  filter?: EventFilterOptions
  /** Pass `false` to disable. Default 10 identical errors per five minutes. */
  spikeProtection?: SpikeProtectionOptions | false
  /** Extra `beforeSend` run before the event filter result is scrubbed. */
  beforeSend?: (event: ErrorEvent, hint: EventHint) => ErrorEvent | null
  /** Called when an enabled environment has no DSN. The caller decides how to warn and dedupe. */
  onMisconfigured?: () => void
  tunnel?: string
  initialScope?: SentryInitOptions['initialScope']
}

/**
 * Compose the least-data, scrubbed, spike-protected init options. The application owns the SDK
 * instance and passes the result to its own `init`. Pipeline order: filter, scrub, spike limit.
 */
export function createSentryInitOptions(input: CreateSentryInitOptionsInput): SentryInitOptions {
  const dsn = input.dsn?.trim() || undefined
  const allowed = isAllowedEnvironment(input.environment, input.enabledEnvironments)
  if (allowed && !dsn) input.onMisconfigured?.()
  const filter = createEventFilter(input.filter)
  const beforeSend = (event: ErrorEvent, hint: EventHint): ErrorEvent | null => {
    const filtered = filter(event, hint)
    return filtered && input.beforeSend ? input.beforeSend(filtered, hint) : filtered
  }
  const scrubbed = composeBeforeSend(
    beforeSend as never,
    input.scrub,
  ) as unknown as SentryInitOptions['beforeSend']
  return {
    dsn,
    environment: input.environment ?? input.fallbackEnvironment ?? 'development',
    release: input.release || undefined,
    enabled: allowed && Boolean(dsn),
    dataCollection: createDataCollectionPolicy({
      credentialHeaders: input.scrub.credentialHeaders,
    }),
    beforeSend:
      input.spikeProtection === false
        ? scrubbed
        : withSpikeProtection(scrubbed, input.spikeProtection),
    beforeSendSpan: createSpanScrubber(input.scrub),
    ...(input.tracesSampleRate === undefined ? {} : { tracesSampleRate: input.tracesSampleRate }),
    ...(input.tunnel === undefined ? {} : { tunnel: input.tunnel }),
    ...(input.initialScope === undefined ? {} : { initialScope: input.initialScope }),
  }
}
