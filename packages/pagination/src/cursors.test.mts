import { describe, expect, it } from 'vitest'

import {
  buildPageInfo,
  decodeCursor,
  decodeScopedAliasCursor,
  decodeScopedPreciseTimestampCursor,
  decodeScopedScoreCursor,
  decodeScopedTierCursor,
  decodeScopedTierPreciseNameCursor,
  decodeScopedTierPreciseUuidCursor,
  decodeScopedTimestampUuidCursor,
  decodeScopedUuidCursor,
  decodeScopedUuidCursorWithLegacySimple,
  decodeUuidCursor,
  encodeCursor,
  encodeScopedAliasCursor,
  encodeScopedPreciseTimestampCursor,
  encodeScopedTierPreciseNameCursor,
  encodeScopedTierPreciseUuidCursor,
  encodeScopedUuidCursor,
  hasExactKeys,
  isNameCursor,
  isPreciseTimestampCursor,
  isPreciseTimestampString,
  isRankingCursor,
  isScopedAliasCursor,
  isScopedOrSimpleCursor,
  isScopedPreciseTimestampCursor,
  isScopedScoreCursor,
  isScopedSimpleCursor,
  isScopedTierCursor,
  isScopedTierPreciseNameCursor,
  isScopedTierPreciseUuidCursor,
  isScopedTimestampCursor,
  isScoreCursor,
  isSimpleCursor,
  isTierCursor,
  isTimestampCursor,
} from './index.mts'

const id = '0191ef72-7fd9-7000-8000-000000000001'
const timestamp = '2026-07-18T07:00:00.123456Z'
const scope = 'owner:recent'
const invalid = 'Invalid cursor'

describe('cursor envelopes', () => {
  it('round-trips opaque base64url JSON and rejects malformed payloads', () => {
    expect(encodeCursor({ id })).not.toContain('=')
    expect(decodeCursor(encodeCursor({ id }))).toEqual({ id })
    expect(decodeCursor('eyJpZCI6IsK-In0')).toEqual({ id: '¾' })
    expect(decodeCursor(Buffer.from(JSON.stringify({ id })).toString('base64'))).toEqual({ id })
    expect(
      decodeCursor(Buffer.from(JSON.stringify({ id })).toString('base64').replace(/=+$/, '')),
    ).toEqual({ id })
    for (const encoded of [
      '%%%',
      'a',
      'a=',
      'a===',
      'a-_+',
      'a-=',
      'a-bcd',
      'eyJpZCI6IsK-In1',
      'aa=',
      'aaa==',
      'eyJpZCI6IjEifQ=',
      'eyJpZCI6IjEifQ===',
      'eyJpZCI6IjEifR',
      'eyJpZCI6IjEifR==',
      '=eyJpZCI6IjEifQ',
      Buffer.from('no json').toString('base64'),
      Buffer.from('null').toString('base64'),
      Buffer.from('[]').toString('base64'),
    ]) {
      expect(() => decodeCursor(encoded)).toThrow(expect.objectContaining({ status: 400 }))
    }
  })

  it('validates UUID cursors and scope ownership', () => {
    expect(decodeUuidCursor(encodeCursor({ id }), isSimpleCursor, invalid)).toEqual({ id })
    expect(
      decodeUuidCursor(
        encodeCursor({ id: '123e4567-e89b-12d3-a456-426614174000' }),
        isSimpleCursor,
        invalid,
      ),
    ).toEqual({ id: '123e4567-e89b-12d3-a456-426614174000' })
    expect(() => decodeUuidCursor(encodeCursor({ id: 'wrong' }), isSimpleCursor, invalid)).toThrow(
      'id is not a valid UUID',
    )
    expect(() => decodeUuidCursor(encodeCursor({ score: 1, id }), isSimpleCursor, invalid)).toThrow(
      invalid,
    )
    expect(() => decodeUuidCursor('%%%', isSimpleCursor, invalid)).toThrow(invalid)
    const encoded = encodeScopedUuidCursor(id, scope)
    expect(decodeScopedUuidCursor(encoded, scope, invalid)).toEqual({ id, scope })
    expect(() => decodeScopedUuidCursor(encoded, 'another', invalid)).toThrow(invalid)
    expect(decodeScopedUuidCursorWithLegacySimple(encodeCursor({ id }), scope, invalid)).toEqual({
      id,
    })
    expect(() => decodeScopedUuidCursorWithLegacySimple(encoded, 'another', invalid)).toThrow(
      invalid,
    )
  })

  it('decodes every scoped shape and rejects another scope', () => {
    const entries = [
      [encodeCursor({ score: 1, id, scope }), decodeScopedScoreCursor],
      [encodeCursor({ timestamp: 1, id, scope }), decodeScopedTimestampUuidCursor],
      [encodeCursor({ tier: 1, id, scope }), decodeScopedTierCursor],
      [
        encodeScopedPreciseTimestampCursor(timestamp, id, scope),
        decodeScopedPreciseTimestampCursor,
      ],
      [
        encodeScopedTierPreciseNameCursor(1, timestamp, 'name', scope),
        decodeScopedTierPreciseNameCursor,
      ],
      [
        encodeScopedTierPreciseUuidCursor(timestamp, 1, id, scope),
        decodeScopedTierPreciseUuidCursor,
      ],
      [encodeScopedAliasCursor('alias', scope), decodeScopedAliasCursor],
    ] as const
    for (const [encoded, decode] of entries) {
      expect(decode(encoded, scope, invalid).scope).toBe(scope)
      expect(() => decode(encoded, 'another', invalid)).toThrow(invalid)
    }
    expect(() =>
      decodeScopedAliasCursor(encodeCursor({ alias: 4, scope }), scope, invalid),
    ).toThrow(invalid)
    expect(() => decodeScopedTierPreciseNameCursor('%%%', scope, invalid)).toThrow(invalid)
  })

  it('builds policy-neutral page metadata', () => {
    expect(buildPageInfo([{ id }], { hasNextPage: true, getCursor: (item) => item })).toEqual({
      hasNextPage: true,
      startCursor: encodeCursor({ id }),
      endCursor: encodeCursor({ id }),
    })
    expect(buildPageInfo([], { hasNextPage: false, getCursor: () => ({ id }) })).toEqual({
      hasNextPage: false,
      startCursor: null,
      endCursor: null,
    })
  })
})

describe('cursor guards', () => {
  it('accepts each exact valid shape', () => {
    expect(hasExactKeys({ id }, ['id'])).toBe(true)
    expect(hasExactKeys(Object.create({ id }), ['id'])).toBe(false)
    expect(hasExactKeys(null, [])).toBe(false)
    expect(hasExactKeys([], [])).toBe(false)
    expect(isSimpleCursor({ id })).toBe(true)
    expect(isScopedSimpleCursor({ id, scope })).toBe(true)
    expect(isScopedOrSimpleCursor({ id, scope })).toBe(true)
    expect(isScoreCursor({ score: 1, id })).toBe(true)
    expect(isScopedScoreCursor({ score: 1, id, scope })).toBe(true)
    expect(isRankingCursor({ ranking: 1, id })).toBe(true)
    expect(isTimestampCursor({ timestamp: 0, id })).toBe(true)
    expect(isScopedTimestampCursor({ timestamp: 0, id, scope })).toBe(true)
    expect(isPreciseTimestampString(timestamp)).toBe(true)
    expect(isPreciseTimestampCursor({ timestamp, id })).toBe(true)
    expect(isScopedPreciseTimestampCursor({ timestamp, id, scope })).toBe(true)
    expect(isNameCursor({ name: 'name', id })).toBe(true)
    expect(isTierCursor({ tier: 1, id })).toBe(true)
    expect(isScopedTierCursor({ tier: 1, id, scope })).toBe(true)
    expect(isScopedAliasCursor({ alias: 'alias', scope })).toBe(true)
    expect(isScopedTierPreciseNameCursor({ tier: 1, timestamp, name: 'name', scope })).toBe(true)
    expect(isScopedTierPreciseUuidCursor({ tier: 1, timestamp, id, scope })).toBe(true)
  })

  it('rejects invalid keys, values, and timestamps', () => {
    expect(isSimpleCursor({ id, extra: true })).toBe(false)
    expect(isScopedOrSimpleCursor({ id: 1 })).toBe(false)
    expect(isScoreCursor({ score: Number.NaN, id })).toBe(false)
    expect(isScopedScoreCursor({ score: 1, id: 2, scope })).toBe(false)
    expect(isRankingCursor({ ranking: Infinity, id })).toBe(false)
    expect(isTimestampCursor({ timestamp: 1.2, id })).toBe(false)
    expect(isTimestampCursor({ timestamp: 8_640_000_000_000_001, id })).toBe(false)
    expect(isScopedTimestampCursor({ timestamp: 1, id, scope: 2 })).toBe(false)
    for (const value of ['2026-07-18T07:00:00Z', '2026-99-18T07:00:00.123456Z'])
      expect(isPreciseTimestampString(value)).toBe(false)
    expect(isPreciseTimestampCursor({ timestamp: 'bad', id })).toBe(false)
    expect(isScopedPreciseTimestampCursor({ timestamp, id, scope: 1 })).toBe(false)
    expect(isNameCursor({ name: 1, id })).toBe(false)
    expect(isTierCursor({ tier: Infinity, id })).toBe(false)
    expect(isScopedTierCursor({ tier: 1, id, scope: 1 })).toBe(false)
    expect(isScopedAliasCursor({ alias: 1, scope })).toBe(false)
    expect(isScopedTierPreciseNameCursor({ tier: 1.2, timestamp, name: 'name', scope })).toBe(false)
    expect(isScopedTierPreciseUuidCursor({ tier: 1, timestamp: 'bad', id, scope })).toBe(false)
  })
})
