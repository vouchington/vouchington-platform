import type { ClientOptions, DataCollection, ErrorEvent, EventHint, Scope } from '@sentry/core'

export interface SentryInitOptions {
  dsn: string | undefined
  environment: string
  release: string | undefined
  enabled: boolean
  tracesSampleRate?: number
  dataCollection: DataCollection
  beforeSend: (
    event: ErrorEvent,
    hint: EventHint,
  ) => ErrorEvent | PromiseLike<ErrorEvent | null> | null
  beforeSendSpan: NonNullable<ClientOptions['beforeSendSpan']>
  tunnel?: string
  initialScope?:
    | { tags?: Record<string, string>; extra?: Record<string, unknown> }
    | ((scope: Scope) => Scope)
}

/** The structural slice of an SDK module the capture helpers need. */
export interface CaptureClient {
  captureException(
    error: unknown,
    hint?: { tags?: Record<string, string>; extra?: Record<string, unknown> },
  ): unknown
}

export interface FlushClient extends CaptureClient {
  flush(timeout?: number): PromiseLike<boolean>
}
