import createHttpError from 'http-errors'

import { decodeCursorBase64 } from './cursor-base64.mts'
import {
  isScopedAliasCursor,
  isScopedOrSimpleCursor,
  isScopedPreciseTimestampCursor,
  isScopedScoreCursor,
  isScopedSimpleCursor,
  isScopedTierCursor,
  isScopedTierPreciseNameCursor,
  isScopedTierPreciseUuidCursor,
  isScopedTimestampCursor,
} from './guards.mts'
import type {
  Cursor,
  ScopedAliasCursor,
  ScopedPreciseTimestampCursor,
  ScopedScoreCursor,
  ScopedSimpleCursor,
  ScopedTierCursor,
  ScopedTierPreciseNameCursor,
  ScopedTierPreciseUuidCursor,
  ScopedTimestampCursor,
  SimpleCursor,
} from './types.mts'

export function encodeCursor<TCursor extends Cursor>(cursor: TCursor): string {
  return Buffer.from(JSON.stringify(cursor)).toString('base64url')
}

export function decodeCursor(encoded: string): Cursor {
  try {
    const parsed: unknown = JSON.parse(decodeCursorBase64(encoded))
    if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
      throw createHttpError(400, 'Cursor must be a non-null object')
    }
    return parsed as Cursor
  } catch (error) {
    if (createHttpError.isHttpError(error)) throw error
    throw createHttpError(400, 'Invalid cursor format', { cause: error })
  }
}

export function decodeUuidCursor<TCursor extends Cursor & { id: string }>(
  encoded: string,
  isExpectedCursor: (cursor: unknown) => cursor is TCursor,
  invalidShapeMessage: string,
): TCursor {
  let cursor: Cursor
  try {
    cursor = decodeCursor(encoded)
  } catch (error) {
    throw invalidCursor(invalidShapeMessage, error)
  }
  if (!isExpectedCursor(cursor)) throw invalidCursor(invalidShapeMessage)
  if (!isUuid(cursor.id)) throw createHttpError(400, 'Invalid cursor: id is not a valid UUID')
  return cursor
}

export function encodeScopedUuidCursor(id: string, scope: string): string {
  return encodeCursor({ id, scope })
}
export function decodeScopedUuidCursor(
  encoded: string,
  expectedScope: string,
  message: string,
): ScopedSimpleCursor {
  return decodeScopedUuid(encoded, expectedScope, message, isScopedSimpleCursor)
}
export function decodeScopedTimestampUuidCursor(
  encoded: string,
  expectedScope: string,
  message: string,
): ScopedTimestampCursor {
  return decodeScopedUuid(encoded, expectedScope, message, isScopedTimestampCursor)
}
export function decodeScopedScoreCursor(
  encoded: string,
  expectedScope: string,
  message: string,
): ScopedScoreCursor {
  return decodeScopedUuid(encoded, expectedScope, message, isScopedScoreCursor)
}
export function decodeScopedTierCursor(
  encoded: string,
  expectedScope: string,
  message: string,
): ScopedTierCursor {
  return decodeScopedUuid(encoded, expectedScope, message, isScopedTierCursor)
}
export function decodeScopedUuidCursorWithLegacySimple(
  encoded: string,
  expectedScope: string,
  message: string,
): ScopedSimpleCursor | SimpleCursor {
  const cursor = decodeUuidCursor(encoded, isScopedOrSimpleCursor, message)
  if (isScopedSimpleCursor(cursor) && cursor.scope !== expectedScope) throw invalidCursor(message)
  return cursor
}
export function encodeScopedAliasCursor(alias: string, scope: string): string {
  return encodeCursor({ alias, scope })
}
export function decodeScopedAliasCursor(
  encoded: string,
  expectedScope: string,
  message: string,
): ScopedAliasCursor {
  const cursor = decodeWithGuard(encoded, isScopedAliasCursor, message)
  if (cursor.scope !== expectedScope) throw invalidCursor(message)
  return cursor
}
export function encodeScopedPreciseTimestampCursor(
  timestamp: string,
  id: string,
  scope: string,
): string {
  return encodeCursor({ timestamp, id, scope })
}
export function decodeScopedPreciseTimestampCursor(
  encoded: string,
  expectedScope: string,
  message: string,
): ScopedPreciseTimestampCursor {
  return decodeScopedUuid(encoded, expectedScope, message, isScopedPreciseTimestampCursor)
}
export function encodeScopedTierPreciseNameCursor(
  tier: number,
  timestamp: string,
  name: string,
  scope: string,
): string {
  return encodeCursor({ tier, timestamp, name, scope })
}
export function decodeScopedTierPreciseNameCursor(
  encoded: string,
  expectedScope: string,
  message: string,
): ScopedTierPreciseNameCursor {
  const cursor = decodeWithGuard(encoded, isScopedTierPreciseNameCursor, message)
  if (cursor.scope !== expectedScope) throw invalidCursor(message)
  return cursor
}
export function encodeScopedTierPreciseUuidCursor(
  timestamp: string,
  tier: number,
  id: string,
  scope: string,
): string {
  return encodeCursor({ timestamp, tier, id, scope })
}
export function decodeScopedTierPreciseUuidCursor(
  encoded: string,
  expectedScope: string,
  message: string,
): ScopedTierPreciseUuidCursor {
  return decodeScopedUuid(encoded, expectedScope, message, isScopedTierPreciseUuidCursor)
}

function decodeScopedUuid<TCursor extends Cursor & { scope: string; id: string }>(
  encoded: string,
  expectedScope: string,
  message: string,
  guard: (cursor: unknown) => cursor is TCursor,
): TCursor {
  const cursor = decodeUuidCursor(encoded, guard, message)
  if (cursor.scope !== expectedScope) throw invalidCursor(message)
  return cursor
}
function decodeWithGuard<TCursor extends Cursor>(
  encoded: string,
  guard: (cursor: unknown) => cursor is TCursor,
  message: string,
): TCursor {
  let cursor: Cursor
  try {
    cursor = decodeCursor(encoded)
  } catch (error) {
    throw invalidCursor(message, error)
  }
  if (!guard(cursor)) throw invalidCursor(message)
  return cursor
}
function invalidCursor(message: string, cause?: unknown) {
  if (cause === undefined) return createHttpError(400, message)
  return createHttpError(400, message, { cause })
}
function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
