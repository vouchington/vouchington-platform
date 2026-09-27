export interface SentryEnvelopeDiagnostics {
  envelopeItemCount?: number
  envelopeItemTypes?: string[]
}

export interface SentryEnvelopeLimits {
  maxBytes: number
  maxItemTypes: number
}

const ITEM_TYPE_PATTERN = /^[a-z0-9_.-]{1,64}$/

/** Read bounded envelope item metadata without inspecting payload content. */
export function getSentryEnvelopeDiagnostics(
  envelope: string,
  limits: SentryEnvelopeLimits,
): SentryEnvelopeDiagnostics {
  if (!Number.isSafeInteger(limits.maxBytes) || limits.maxBytes < 1) {
    throw new RangeError('maxBytes must be a positive safe integer')
  }
  if (!Number.isSafeInteger(limits.maxItemTypes) || limits.maxItemTypes < 0) {
    throw new RangeError('maxItemTypes must be a non-negative safe integer')
  }
  if (
    envelope.length > limits.maxBytes ||
    new TextEncoder().encode(envelope).length > limits.maxBytes
  ) {
    throw new RangeError('Envelope exceeds maxBytes')
  }
  const firstLineEnd = envelope.indexOf('\n')
  if (firstLineEnd === -1) return {}

  const itemTypes: string[] = []
  let itemCount = 0
  let cursor = firstLineEnd + 1
  while (cursor < envelope.length) {
    if (envelope[cursor] === '\n') {
      cursor += 1
      continue
    }
    const itemHeaderEnd = envelope.indexOf('\n', cursor)
    if (itemHeaderEnd === -1) break
    const line = envelope.slice(cursor, itemHeaderEnd).replace(/\r$/, '')
    cursor = itemHeaderEnd + 1
    if (!line) continue

    let header: unknown
    try {
      header = JSON.parse(line)
    } catch {
      break
    }
    if (!header || typeof header !== 'object' || Array.isArray(header)) break

    itemCount += 1
    const type = (header as Record<string, unknown>).type
    if (
      typeof type === 'string' &&
      ITEM_TYPE_PATTERN.test(type) &&
      !itemTypes.includes(type) &&
      itemTypes.length < limits.maxItemTypes
    ) {
      itemTypes.push(type)
    }

    const length = (header as Record<string, unknown>).length
    if (typeof length === 'number' && Number.isSafeInteger(length) && length >= 0) {
      const next = advanceByUtf8Bytes(envelope, cursor, length)
      if (next === null) break
      cursor = next
      if (envelope[cursor] === '\r' && envelope[cursor + 1] === '\n') cursor += 2
      else if (envelope[cursor] === '\n') cursor += 1
      continue
    }

    const payloadEnd = envelope.indexOf('\n', cursor)
    if (payloadEnd === -1) break
    cursor = payloadEnd + 1
  }
  return {
    ...(itemCount > 0 ? { envelopeItemCount: itemCount } : {}),
    ...(itemTypes.length > 0 ? { envelopeItemTypes: itemTypes } : {}),
  }
}

function advanceByUtf8Bytes(envelope: string, cursor: number, length: number): number | null {
  let bytes = 0
  while (cursor < envelope.length && bytes < length) {
    const point = envelope.codePointAt(cursor)!
    const size = point <= 0x7f ? 1 : point <= 0x7ff ? 2 : point <= 0xffff ? 3 : 4
    if (bytes + size > length) return null
    bytes += size
    cursor += point > 0xffff ? 2 : 1
  }
  return bytes === length ? cursor : null
}
