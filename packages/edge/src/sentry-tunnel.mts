import { getSentryEnvelopeDiagnostics } from '@vouchington/utils/sentry-envelope'
import { edgeErrorResponse, withFailureNoStoreHeaders } from './error-response.mts'
import { parseSentryDsn, type SentryDsnConfig } from './sentry-dsn.mts'
import {
  logSentryTunnelForwardFailure,
  logSentryTunnelRejection,
  logSentryTunnelUpstreamResponse,
  type SentryTunnelDiagnosticDetails,
  type SentryTunnelLog,
  type SentryTunnelRejectReason,
} from './sentry-tunnel-diagnostics.mts'

export type SentryTunnelOptions = {
  /** Raw DSNs the tunnel may forward to. Invalid and missing entries are ignored. */
  trustedDsns: readonly (string | undefined)[]
  /** Envelope size cap. Defaults to 1,000,000 bytes. */
  maxBytes?: number
  /** Distinct item types recorded in failure diagnostics. Defaults to 8. */
  maxItemTypes?: number
  fetch?: (url: string, init: RequestInit) => Promise<Response>
  log?: SentryTunnelLog
}

type ReadResult = { kind: 'ok'; envelope: string } | { kind: 'too-large' } | { kind: 'read-error' }

async function readEnvelopeWithLimit(request: Request, maxBytes: number): Promise<ReadResult> {
  if (!request.body) return { kind: 'ok', envelope: '' }
  try {
    const reader = request.body.getReader()
    const decoder = new TextDecoder()
    const chunks: string[] = []
    let bytesRead = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) {
        chunks.push(decoder.decode())
        return { kind: 'ok', envelope: chunks.join('') }
      }
      bytesRead += value.byteLength
      if (bytesRead > maxBytes) {
        reader.cancel().catch(() => {})
        return { kind: 'too-large' }
      }
      chunks.push(decoder.decode(value, { stream: true }))
    }
  } catch {
    return { kind: 'read-error' }
  }
}

/**
 * Builds a handler that proxies browser Sentry envelopes to trusted DSNs, bypassing ad-blockers.
 * The DSN in each envelope header must match a trusted DSN exactly. Upstream responses are not
 * forwarded; only the status is, so Sentry rate-limit headers never reach browsers.
 */
export function createSentryTunnel(
  options: SentryTunnelOptions,
): (request: Request) => Promise<Response> {
  const maxBytes = options.maxBytes ?? 1_000_000
  const maxItemTypes = options.maxItemTypes ?? 8
  const log = options.log ?? console
  const send = options.fetch ?? fetch
  const trusted = options.trustedDsns
    .map(parseSentryDsn)
    .filter((dsn): dsn is SentryDsnConfig => dsn !== undefined)
  const diagnostics = (envelope: string) =>
    getSentryEnvelopeDiagnostics(envelope, { maxBytes, maxItemTypes })

  return async function handleSentryTunnel(request) {
    const reject = (
      status: number,
      message: string,
      code: string,
      reason: SentryTunnelRejectReason,
      details?: SentryTunnelDiagnosticDetails,
    ) => {
      logSentryTunnelRejection(log, request, status, reason, details)
      return edgeErrorResponse(status, message, code)
    }
    if (trusted.length === 0) {
      return reject(503, 'Service Unavailable', 'SERVICE_UNAVAILABLE', 'configuration_unavailable')
    }
    const contentLength = request.headers.get('content-length')
    if (contentLength !== null && Number(contentLength) > maxBytes) {
      return reject(413, 'Payload Too Large', 'INVALID_INPUT', 'content_length_too_large', {
        limitBytes: maxBytes,
      })
    }
    const read = await readEnvelopeWithLimit(request, maxBytes)
    if (read.kind === 'too-large') {
      return reject(413, 'Payload Too Large', 'INVALID_INPUT', 'body_too_large', {
        limitBytes: maxBytes,
      })
    }
    if (read.kind === 'read-error') {
      return reject(400, 'Bad Request', 'INVALID_INPUT', 'body_read_error')
    }
    const { envelope } = read

    let header: unknown
    try {
      header = JSON.parse(envelope.split('\n')[0] as string)
    } catch {
      return reject(400, 'Invalid envelope header', 'INVALID_INPUT', 'invalid_envelope_header')
    }
    const dsn =
      typeof header === 'object' && header !== null
        ? (header as Record<string, unknown>).dsn
        : undefined
    if (typeof dsn !== 'string') return reject(400, 'Missing DSN', 'INVALID_INPUT', 'missing_dsn')
    const envelopeDsn = parseSentryDsn(dsn)
    if (!envelopeDsn) return reject(400, 'Invalid DSN', 'INVALID_INPUT', 'invalid_dsn')
    const target = trusted.find((candidate) => candidate.dsn === envelopeDsn.dsn)
    if (!target) return reject(403, 'Forbidden', 'FORBIDDEN', 'dsn_not_allowed')

    let upstream: Response
    try {
      upstream = await send(target.envelopeUrl, {
        method: 'POST',
        body: envelope,
        headers: { 'content-type': 'application/x-sentry-envelope' },
      })
    } catch (error) {
      logSentryTunnelForwardFailure(log, request, target.projectId, error, diagnostics(envelope))
      return edgeErrorResponse(502, 'Bad Gateway', 'BAD_GATEWAY')
    }
    if (upstream.status < 200 || upstream.status >= 300) {
      logSentryTunnelUpstreamResponse(
        log,
        request,
        target.projectId,
        upstream.status,
        diagnostics(envelope),
      )
    }
    return withFailureNoStoreHeaders(new Response(null, { status: upstream.status }))
  }
}
