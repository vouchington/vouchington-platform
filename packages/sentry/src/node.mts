import { captureError, type CaptureOptions } from './capture.mts'
import { createSentryInitOptions, type CreateSentryInitOptionsInput } from './init-options.mts'
import type { FlushClient, SentryInitOptions } from './types.mts'

/** Structural slice of `@sentry/node` (or `@sentry/aws-serverless`) used for initialization. */
export interface NodeSentryClient extends FlushClient {
  init(options: SentryInitOptions): unknown
}

/** Build the init options and call the app-owned Node SDK's `init`. Returns the options used. */
export function initNodeSentry(
  client: Pick<NodeSentryClient, 'init'>,
  input: CreateSentryInitOptionsInput,
): SentryInitOptions {
  const options = createSentryInitOptions(input)
  client.init(options)
  return options
}

/**
 * Report an error, then flush so short-lived processes (lambdas, scripts) do not exit before
 * delivery. Returns false when the error was expected or the flush timed out.
 */
export async function captureAndFlush(
  client: FlushClient,
  error: unknown,
  options: CaptureOptions & { flushTimeoutMs?: number },
): Promise<boolean> {
  if (!captureError(client, error, options)) return false
  return await client.flush(options.flushTimeoutMs ?? 2000)
}

export { captureError, createSentryInitOptions }
export type { CaptureOptions, CreateSentryInitOptionsInput, FlushClient, SentryInitOptions }
