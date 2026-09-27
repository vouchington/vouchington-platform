import { describe, expect, it } from 'vitest'
import { getSentryEnvelopeDiagnostics } from './sentry-envelope.mts'

const limits = { maxBytes: 4096, maxItemTypes: 2 }
const envelope = (items: string): string => `{"dsn":"caller-owned"}\n${items}`

describe('getSentryEnvelopeDiagnostics', () => {
  it('returns no metadata for a missing envelope separator or incomplete first item', () => {
    expect(getSentryEnvelopeDiagnostics('{}', limits)).toEqual({})
    expect(getSentryEnvelopeDiagnostics(envelope('{"type":"event"'), limits)).toEqual({})
    expect(getSentryEnvelopeDiagnostics(envelope('null\n{}'), limits)).toEqual({})
    expect(getSentryEnvelopeDiagnostics(envelope('[]\n{}'), limits)).toEqual({})
  })

  it('counts items, skips blank and CRLF separators, and preserves partial metadata', () => {
    expect(getSentryEnvelopeDiagnostics(envelope('\n\r\n{"type":"event"}\n{}\n'), limits)).toEqual({
      envelopeItemCount: 1,
      envelopeItemTypes: ['event'],
    })
    expect(
      getSentryEnvelopeDiagnostics(envelope('{"type":"event"}\n{}\nnot-json\n{}'), limits),
    ).toEqual({ envelopeItemCount: 1, envelopeItemTypes: ['event'] })
    expect(getSentryEnvelopeDiagnostics(envelope('{"type":"event"}\n{}'), limits)).toEqual({
      envelopeItemCount: 1,
      envelopeItemTypes: ['event'],
    })
  })

  it('uses byte lengths across ASCII, BMP, and supplementary UTF-8 payloads', () => {
    for (const payload of ['ab', 'é', '漢', '🙂']) {
      const bytes = new TextEncoder().encode(payload).length
      expect(
        getSentryEnvelopeDiagnostics(
          envelope(
            `{"type":"event","length":${bytes}}\n${payload}\r\n{"type":"transaction","length":0}\n`,
          ),
          limits,
        ),
      ).toEqual({ envelopeItemCount: 2, envelopeItemTypes: ['event', 'transaction'] })
    }
    expect(
      getSentryEnvelopeDiagnostics(
        envelope('{"type":"event","length":4}\n🙂\n{"type":"transaction"}\n{}\n'),
        limits,
      ).envelopeItemCount,
    ).toBe(2)
  })

  it('stops at an incomplete or split byte-length payload while retaining its header', () => {
    for (const item of ['{"type":"event","length":4}\né\n', '{"type":"event","length":1}\né\n']) {
      expect(getSentryEnvelopeDiagnostics(envelope(item), limits)).toEqual({
        envelopeItemCount: 1,
        envelopeItemTypes: ['event'],
      })
    }
  })

  it('deduplicates valid types and caps their diagnostic list', () => {
    const items = ['event', 'event', 'transaction', 'profile', 'INVALID TYPE', 'x'.repeat(65)]
      .map((type) => `{"type":"${type}","length":0}\n`)
      .join('')
    expect(getSentryEnvelopeDiagnostics(envelope(items), limits)).toEqual({
      envelopeItemCount: 6,
      envelopeItemTypes: ['event', 'transaction'],
    })
    expect(getSentryEnvelopeDiagnostics(envelope('{"type":42,"length":0}\n'), limits)).toEqual({
      envelopeItemCount: 1,
    })
    expect(
      getSentryEnvelopeDiagnostics(envelope('{"type":"event","length":0}\n'), {
        ...limits,
        maxItemTypes: 0,
      }),
    ).toEqual({ envelopeItemCount: 1 })
  })

  it('falls back to line payloads for invalid length fields', () => {
    for (const length of ['"bad"', '-1', '1.5']) {
      expect(
        getSentryEnvelopeDiagnostics(
          envelope(`{"type":"event","length":${length}}\n{}\n{"type":"transaction"}\n{}\n`),
          limits,
        ).envelopeItemCount,
      ).toBe(2)
    }
  })

  it('requires caller limits and checks UTF-8 bytes, not string units', () => {
    expect(() => getSentryEnvelopeDiagnostics('', { ...limits, maxBytes: 0 })).toThrow(RangeError)
    expect(() => getSentryEnvelopeDiagnostics('', { ...limits, maxBytes: 1.5 })).toThrow(RangeError)
    expect(() => getSentryEnvelopeDiagnostics('', { ...limits, maxItemTypes: -1 })).toThrow(
      RangeError,
    )
    expect(() => getSentryEnvelopeDiagnostics('', { ...limits, maxItemTypes: 1.5 })).toThrow(
      RangeError,
    )
    expect(() => getSentryEnvelopeDiagnostics('a'.repeat(5), { ...limits, maxBytes: 4 })).toThrow(
      RangeError,
    )
    expect(() => getSentryEnvelopeDiagnostics('é', { ...limits, maxBytes: 1 })).toThrow(RangeError)
    expect(getSentryEnvelopeDiagnostics('é', { ...limits, maxBytes: 2 })).toEqual({})
  })
})
