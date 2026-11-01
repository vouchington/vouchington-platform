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

type ReadResult =
  | { kind: 'ok'; envelope: Uint8Array }
  | { kind: 'too-large' }
  | { kind: 'read-error' }

function concatChunks(chunks: readonly Uint8Array[], length: number): Uint8Array {
  const joined = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}

/** Buffers the raw bytes: attachment and replay items are binary and must reach Sentry intact. */
async function readEnvelopeWithLimit(request: Request, maxBytes: number): Promise<ReadResult> {
  if (!request.body) return { kind: 'ok', envelope: new Uint8Array() }
  try {
    const reader = request.body.getReader()
    const chunks: Uint8Array[] = []
    let bytesRead = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) return { kind: 'ok', envelope: concatChunks(chunks, bytesRead) }
      bytesRead += value.byteLength
      if (bytesRead > maxBytes) {
        reader.cancel().catch(() => {})
        return { kind: 'too-large' }
      }
      chunks.push(value)
    }
  } catch {
    return { kind: 'read-error' }
  }
}

/** Parses only the header line; the rest of the envelope may not be valid UTF-8. */
function parseEnvelopeHeader(envelope: Uint8Array): unknown {
  const newline = envelope.indexOf(10)
  const line = envelope.subarray(0, newline === -1 ? envelope.length : newline)
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line))
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
  // Diagnostics inspect item headers only, so a lossy decode here never touches the forwarded bytes.
  const diagnostics = (envelope: Uint8Array) =>
    getSentryEnvelopeDiagnostics(new TextDecoder().decode(envelope), { maxBytes, maxItemTypes })

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
      header = parseEnvelopeHeader(envelope)
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
