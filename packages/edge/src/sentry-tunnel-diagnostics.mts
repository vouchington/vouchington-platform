export type SentryTunnelRejectReason =
  | 'content_length_too_large'
  | 'body_too_large'
  | 'body_read_error'
  | 'invalid_envelope_header'
  | 'missing_dsn'
  | 'invalid_dsn'
  | 'configuration_unavailable'
  | 'dsn_not_allowed'

export type SentryTunnelDiagnosticDetails = {
  envelopeItemCount?: number
  envelopeItemTypes?: string[]
  errorName?: string
  errorCauseName?: string
  errorCode?: string
  limitBytes?: number
  projectId?: string
}

export type SentryTunnelLog = {
  warn: (line: string) => void
  error: (line: string) => void
}

const ERROR_CODE_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/u

function requestDiagnostics(request: Request) {
  const rawLength = request.headers.get('content-length')
  const length = rawLength === null ? undefined : Number(rawLength)
  const ray = (request as { cf?: { ray?: string } }).cf?.ray ?? request.headers.get('cf-ray')
  return {
    method: request.method,
    requestPath: new URL(request.url).pathname,
    ...(ray ? { cfRay: ray } : {}),
    ...(typeof length === 'number' && Number.isFinite(length)
      ? { contentLengthBytes: length }
      : {}),
  }
}

export function logSentryTunnelRejection(
  log: SentryTunnelLog,
  request: Request,
  status: number,
  reason: SentryTunnelRejectReason,
  details: SentryTunnelDiagnosticDetails = {},
): void {
  log.warn(
    JSON.stringify({
      message: 'sentry_tunnel_rejected',
      reason,
      status,
      ...requestDiagnostics(request),
      ...details,
    }),
  )
}

export function logSentryTunnelForwardFailure(
  log: SentryTunnelLog,
  request: Request,
  projectId: string,
  error: unknown,
  details: SentryTunnelDiagnosticDetails = {},
): void {
  log.error(
    JSON.stringify({
      message: 'sentry_tunnel_forward_failed',
      reason: 'sentry_fetch_error',
      status: 502,
      ...requestDiagnostics(request),
      projectId,
      ...details,
      ...errorDiagnostics(error),
    }),
  )
}

export function logSentryTunnelUpstreamResponse(
  log: SentryTunnelLog,
  request: Request,
  projectId: string,
  status: number,
  details: SentryTunnelDiagnosticDetails = {},
): void {
  log.warn(
    JSON.stringify({
      message: 'sentry_tunnel_upstream_response',
      reason: 'sentry_upstream_non_2xx',
      status,
      ...requestDiagnostics(request),
      projectId,
      ...details,
    }),
  )
}

/** Only error names and bounded codes are logged; messages may carry request data. */
function errorDiagnostics(error: unknown): SentryTunnelDiagnosticDetails {
  const details: SentryTunnelDiagnosticDetails = { errorName: errorName(error) ?? typeof error }
  const code = safeErrorCode(error)
  if (code !== undefined) details.errorCode = code
  const cause = error instanceof Error ? error.cause : undefined
  if (cause !== undefined && cause !== null) {
    const causeName = errorName(cause)
    if (causeName !== undefined) details.errorCauseName = causeName
    const causeCode = safeErrorCode(cause)
    if (details.errorCode === undefined && causeCode !== undefined) details.errorCode = causeCode
  }
  return details
}

function errorName(error: unknown): string | undefined {
  return error instanceof Error && typeof error.name === 'string' ? error.name : undefined
}

function safeErrorCode(error: unknown): string | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = (error as { code?: unknown }).code
  if (typeof code !== 'string' && typeof code !== 'number') return undefined
  const normalized = String(code)
  return ERROR_CODE_PATTERN.test(normalized) ? normalized : undefined
}
