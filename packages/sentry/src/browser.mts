import { captureError, type CaptureOptions } from './capture.mts'
import { createSentryInitOptions, type CreateSentryInitOptionsInput } from './init-options.mts'
import type { CaptureClient, SentryInitOptions } from './types.mts'

/** Structural slice of `@sentry/browser` (or `@sentry/nextjs`) used for initialization. */
export interface BrowserSentryClient extends CaptureClient {
  init(options: SentryInitOptions): unknown
}

/**
 * Build the init options and call the app-owned browser SDK's `init`. Browser events are routed
 * through the injected `tunnel` (same-origin envelope endpoint) when one is supplied.
 */
export function initBrowserSentry(
  client: Pick<BrowserSentryClient, 'init'>,
  input: CreateSentryInitOptionsInput,
): SentryInitOptions {
  const options = createSentryInitOptions(input)
  client.init(options)
  return options
}

export { captureError }
export type { CaptureOptions, CreateSentryInitOptionsInput, SentryInitOptions }
