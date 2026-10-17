import { isRecord } from './errors.mts'
import type { ProviderErrorDetail } from './types.mts'

const MAX_BODY_BYTES = 16 * 1024
const MAX_MESSAGE_CHARS = 200
const MAX_FIELD_CHARS = 64
const MAX_REASONS = 8
const REDACTED = '[redacted]'
// Provider codes and types are short machine identifiers. Anything with whitespace or punctuation
// beyond these is free text, which may carry user content, so it is dropped rather than kept.
const IDENTIFIER = /^[\w.:-]{1,64}$/

/** The part of a `Response` this module reads. */
export type ErrorBodyResponse = { body: AsyncIterable<Uint8Array> | null }

function identifier(value: unknown): string | undefined {
  const text = typeof value === 'number' ? String(value) : value
  return typeof text === 'string' && IDENTIFIER.test(text) ? text : undefined
}

function shortText(value: unknown): string | undefined {
  const text = typeof value === 'number' ? String(value) : value
  if (typeof text !== 'string' || text.length === 0) return undefined
  return text.slice(0, MAX_FIELD_CHARS)
}

function boundMessage(message: string, flaggedInput: unknown): string {
  // The provider truncates a long `flagged_input` in the middle with "...", so each remaining
  // fragment is cut as well as the whole value.
  const fragments =
    typeof flaggedInput === 'string'
      ? [flaggedInput, ...flaggedInput.split('...')].filter((fragment) => fragment.length >= 4)
      : []
  const redacted = fragments.reduce(
    (text, fragment) => text.split(fragment).join(REDACTED),
    message,
  )
  return redacted.replace(/\s+/g, ' ').trim().slice(0, MAX_MESSAGE_CHARS)
}

/** Reads at most `MAX_BODY_BYTES`; an unreadable body is `null`. Never throws. */
async function readBoundedText(response: ErrorBodyResponse): Promise<string | null> {
  if (!response.body) return null
  const chunks: Buffer[] = []
  let size = 0
  try {
    for await (const chunk of response.body) {
      chunks.push(Buffer.from(chunk))
      size += chunk.byteLength
      if (size >= MAX_BODY_BYTES) break
    }
  } catch {
    return null
  }
  return Buffer.concat(chunks).subarray(0, MAX_BODY_BYTES).toString('utf8')
}

/** Parses a decoded error body into its safe fields, or `undefined` for any other shape. */
export function parseProviderErrorDetail(body: unknown): ProviderErrorDetail | undefined {
  if (!isRecord(body) || !isRecord(body.error)) return undefined
  const { code, message, metadata } = body.error
  const meta = isRecord(metadata) ? metadata : {}
  const errorType = identifier(meta.error_type)
  const providerCode = identifier(meta.provider_code)
  const providerName = shortText(meta.provider_name)
  const modelSlug = shortText(meta.model_slug)
  const limitSource = identifier(meta.limit_source)
  const reasons = Array.isArray(meta.reasons)
    ? meta.reasons.flatMap((reason) => shortText(reason) ?? []).slice(0, MAX_REASONS)
    : undefined
  const safeMessage = typeof message === 'string' ? boundMessage(message, meta.flagged_input) : null
  return {
    ...(typeof code === 'number' && Number.isFinite(code) ? { code } : {}),
    ...(typeof code === 'string' && IDENTIFIER.test(code) ? { code } : {}),
    ...(safeMessage ? { providerMessage: safeMessage } : {}),
    ...(errorType ? { errorType } : {}),
    ...(providerCode ? { providerCode } : {}),
    ...(reasons ? { reasons } : {}),
    ...(providerName ? { providerName } : {}),
    ...(modelSlug ? { modelSlug } : {}),
    ...(limitSource ? { limitSource } : {}),
    moderation: 'flagged_input' in meta || Array.isArray(meta.reasons),
    guardrail: 'patterns' in meta,
  }
}

/**
 * Reads the provider's error body, bounded, and keeps only the documented safe fields. A moderation
 * block's `flagged_input` is user content: it is never kept, and any echo of it is cut from the
 * message. A missing, unreadable, or undocumented body yields `undefined`, never an exception.
 */
export async function readProviderErrorDetail(
  response: ErrorBodyResponse,
): Promise<ProviderErrorDetail | undefined> {
  const text = await readBoundedText(response)
  if (text === null) return undefined
  try {
    return parseProviderErrorDetail(JSON.parse(text))
  } catch {
    return undefined
  }
}

/** A one-line, already-bounded description for an error message or log line. */
export function describeProviderErrorDetail(detail: ProviderErrorDetail): string {
  const head = [
    detail.code === undefined ? '' : `code ${detail.code}`,
    detail.errorType ? `type ${detail.errorType}` : '',
    detail.providerCode ? `provider code ${detail.providerCode}` : '',
  ]
    .filter(Boolean)
    .join(', ')
  return [head, detail.providerMessage ?? ''].filter(Boolean).join(': ')
}
