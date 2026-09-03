import { UnrecoverableError, Worker } from 'glide-mq'

export { UnrecoverableError }

export type TerminalErrorConstructor = new (message: string) => Error
export type RateLimitErrorConstructor = new () => Error

export interface QueueErrorConstructors {
  UnrecoverableError?: TerminalErrorConstructor
  RateLimitError?: RateLimitErrorConstructor
}

export interface HttpRetryOptions extends Pick<QueueErrorConstructors, 'UnrecoverableError'> {
  getStatus?: (error: unknown) => number | undefined
  isRetryableStatus?: (status: number) => boolean
}

export interface QueueRateLimiter {
  rateLimit(durationMs: number): Promise<void>
}

export interface RateLimitedErrorOptions extends QueueErrorConstructors, HttpRetryOptions {
  cooldownMs: number
  isRateLimited: (error: unknown) => boolean
  onUnhandled?: (error: unknown) => never
}

// Throws an error from the injected constructor, defaulting to GlideMQ's terminal error while retaining useful source diagnostics.
export function unrecoverable(
  error: unknown,
  message?: string,
  options: Pick<QueueErrorConstructors, 'UnrecoverableError'> = {},
): never {
  const source = toError(error)
  const ErrorCtor = options.UnrecoverableError ?? UnrecoverableError
  const terminal = new ErrorCtor(message ?? source.message)
  if (source.stack !== undefined) terminal.stack = source.stack
  throw terminal
}

// Returns the common HTTP status fields used by HTTP client libraries.
export function getHttpStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const candidate = error as { status?: unknown; statusCode?: unknown }
  if (isStatus(candidate.status)) return candidate.status
  return isStatus(candidate.statusCode) ? candidate.statusCode : undefined
}

// Marks 408, 429, and server failures as retryable by default.
export function isRetryableHttpStatus(status: number): boolean {
  return status === 408 || status === 429 || (status >= 500 && status <= 599)
}

// Throws terminal errors for non-retryable client responses; rethrows all other failures.
export function wrapHttpForRetry(error: unknown, options: HttpRetryOptions = {}): never {
  const status = (options.getStatus ?? getHttpStatus)(error)
  const retryable = options.isRetryableStatus ?? isRetryableHttpStatus
  if (status !== undefined && status >= 400 && status <= 599 && !retryable(status)) {
    unrecoverable(error, undefined, options)
  }
  throw error
}

// Pauses a GlideMQ worker for caller-defined provider limits, then requeues the current job.
export async function handleRateLimitedError(
  error: unknown,
  worker: QueueRateLimiter,
  options: RateLimitedErrorOptions,
): Promise<never> {
  assertCooldown(options.cooldownMs)
  if (options.isRateLimited(error)) {
    await worker.rateLimit(options.cooldownMs)
    const RateLimitError = options.RateLimitError ?? Worker.RateLimitError
    throw Object.assign(new RateLimitError(), { delayMs: options.cooldownMs })
  }
  const onUnhandled = options.onUnhandled ?? ((value: unknown) => wrapHttpForRetry(value, options))
  return onUnhandled(error)
}

function assertCooldown(cooldownMs: number): void {
  if (!Number.isSafeInteger(cooldownMs) || cooldownMs <= 0) {
    throw new TypeError('cooldownMs must be a positive safe integer')
  }
}

function isStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599
}

function toError(error: unknown): Error {
  if (error instanceof Error) return error
  if (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { message?: unknown }).message === 'string'
  ) {
    const source = new Error((error as { message: string }).message)
    const stack = (error as { stack?: unknown }).stack
    if (typeof stack === 'string') source.stack = stack
    return source
  }
  return new Error(String(error))
}
