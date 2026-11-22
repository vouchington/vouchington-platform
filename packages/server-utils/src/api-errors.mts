import { STATUS_CODES } from 'node:http'

/** House JSON error envelope. `code`, `request_id`, and `stack` are omitted when absent. */
export interface ApiErrorEnvelope {
  readonly message: string
  readonly code?: string
  readonly request_id?: string
  readonly stack?: string
}

export interface BuildApiErrorEnvelopeOptions {
  /** Request correlation id echoed as `request_id`. */
  readonly requestId?: string | null
  /** When false, 5xx errors are redacted to the status text and stacks are omitted. */
  readonly exposeDetails: boolean
}

export function getErrorStatus(error: unknown): number {
  if (!isObjectLike(error)) return 500
  return (
    getValidHttpStatus(safeRead(error, 'status')) ??
    getValidHttpStatus(safeRead(error, 'statusCode')) ??
    500
  )
}

/** Stamps `status` on 5xx errors so loggers and reporters classify them consistently. */
export function normalizeErrorForLogging(error: Error): Error {
  const status = getErrorStatus(error)
  if (status >= 500) Object.assign(error, { status })
  return error
}

export function getErrorResponseMessage(error: unknown, status: number): string {
  if (isObjectLike(error)) {
    const message = safeRead(error, 'message')
    if (message !== undefined && message !== null) {
      return safeString(message) ?? getStatusMessage(status)
    }
    return getStatusMessage(status)
  }
  if (error === null || error === undefined) return getStatusMessage(status)
  // Only primitives reach here, and String() cannot throw for them.
  return String(error as string | number | boolean | bigint | symbol)
}

export function getErrorResponseCode(error: unknown, status: number): string | undefined {
  const code = safeRead(error, 'code')
  if (typeof code === 'string') return code
  return status >= 500 ? 'INTERNAL_ERROR' : undefined
}

export function getErrorResponseStack(error: unknown): string | undefined {
  const stack = safeRead(error, 'stack')
  return typeof stack === 'string' ? stack : undefined
}

export function getStatusMessage(status: number): string {
  return STATUS_CODES[status] ?? 'Internal Server Error'
}

/**
 * Builds the house error envelope. With `exposeDetails: false`, 5xx errors collapse to the HTTP
 * status text with code `INTERNAL_ERROR` and never leak messages or stacks; 4xx messages and
 * codes are still returned. Callers own serialization, logging, and environment policy.
 */
export function buildApiErrorEnvelope(
  error: unknown,
  options: BuildApiErrorEnvelopeOptions,
): { readonly status: number; readonly body: ApiErrorEnvelope } {
  const status = getErrorStatus(error)
  const requestId = options.requestId ? { request_id: options.requestId } : {}
  if (!options.exposeDetails && status >= 500) {
    return {
      status,
      body: { message: getStatusMessage(status), code: 'INTERNAL_ERROR', ...requestId },
    }
  }
  const code = getErrorResponseCode(error, status)
  const stack = options.exposeDetails ? getErrorResponseStack(error) : undefined
  return {
    status,
    body: {
      message: getErrorResponseMessage(error, status),
      ...(code ? { code } : {}),
      ...requestId,
      ...(stack ? { stack } : {}),
    },
  }
}

function getValidHttpStatus(status: unknown): number | undefined {
  if (typeof status === 'number' && Number.isInteger(status) && status >= 400 && status <= 599) {
    return status
  }
  return undefined
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function safeString(value: unknown): string | undefined {
  try {
    return String(value)
  } catch {
    return undefined
  }
}

/** Reads a property of a thrown value; hostile getters and Proxy traps yield undefined. */
function safeRead(value: unknown, key: string): unknown {
  if (!isObjectLike(value)) return undefined
  try {
    return value[key]
  } catch {
    return undefined
  }
}
