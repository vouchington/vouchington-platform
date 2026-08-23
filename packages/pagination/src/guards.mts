import type {
  NameCursor,
  PreciseTimestampCursor,
  RankingCursor,
  ScopedAliasCursor,
  ScopedPreciseTimestampCursor,
  ScopedScoreCursor,
  ScopedSimpleCursor,
  ScopedTierCursor,
  ScopedTierPreciseNameCursor,
  ScopedTierPreciseUuidCursor,
  ScopedTimestampCursor,
  ScoreCursor,
  SimpleCursor,
  TierCursor,
  TimestampCursor,
} from './types.mts'

export function hasExactKeys<TKeys extends string>(
  value: unknown,
  keys: readonly TKeys[],
): value is Record<TKeys, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false
  const valueKeys = Object.keys(value)
  return valueKeys.length === keys.length && keys.every((key) => Object.hasOwn(value, key))
}

export function isSimpleCursor(value: unknown): value is SimpleCursor {
  return hasExactKeys(value, ['id']) && typeof value.id === 'string'
}
export function isScopedSimpleCursor(value: unknown): value is ScopedSimpleCursor {
  return hasExactKeys(value, ['id', 'scope']) && hasStrings(value, 'id', 'scope')
}
export function isScopedOrSimpleCursor(value: unknown): value is ScopedSimpleCursor | SimpleCursor {
  return isScopedSimpleCursor(value) || isSimpleCursor(value)
}
export function isScoreCursor(value: unknown): value is ScoreCursor {
  return hasExactKeys(value, ['score', 'id']) && hasFiniteNumberAndStrings(value, 'score', 'id')
}
export function isScopedScoreCursor(value: unknown): value is ScopedScoreCursor {
  return (
    hasExactKeys(value, ['score', 'id', 'scope']) &&
    hasFiniteNumberAndStrings(value, 'score', 'id', 'scope')
  )
}
export function isRankingCursor(value: unknown): value is RankingCursor {
  return hasExactKeys(value, ['ranking', 'id']) && hasFiniteNumberAndStrings(value, 'ranking', 'id')
}
export function isTimestampCursor(value: unknown): value is TimestampCursor {
  return (
    hasExactKeys(value, ['timestamp', 'id']) && hasSafeTimestampAndStrings(value, 'timestamp', 'id')
  )
}
export function isScopedTimestampCursor(value: unknown): value is ScopedTimestampCursor {
  return (
    hasExactKeys(value, ['timestamp', 'id', 'scope']) &&
    hasSafeTimestampAndStrings(value, 'timestamp', 'id', 'scope')
  )
}
export function isPreciseTimestampString(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value)) return false
  const milliseconds = value.replace(/\.(\d{3})\d{3}Z$/, '.$1Z')
  return (
    !Number.isNaN(Date.parse(milliseconds)) && new Date(milliseconds).toISOString() === milliseconds
  )
}
export function isPreciseTimestampCursor(value: unknown): value is PreciseTimestampCursor {
  return (
    hasExactKeys(value, ['timestamp', 'id']) &&
    hasPreciseTimestampAndStrings(value, 'timestamp', 'id')
  )
}
export function isScopedPreciseTimestampCursor(
  value: unknown,
): value is ScopedPreciseTimestampCursor {
  return (
    hasExactKeys(value, ['timestamp', 'id', 'scope']) &&
    hasPreciseTimestampAndStrings(value, 'timestamp', 'id', 'scope')
  )
}
export function isNameCursor(value: unknown): value is NameCursor {
  return hasExactKeys(value, ['name', 'id']) && hasStrings(value, 'name', 'id')
}
export function isTierCursor(value: unknown): value is TierCursor {
  return hasExactKeys(value, ['tier', 'id']) && hasFiniteNumberAndStrings(value, 'tier', 'id')
}
export function isScopedTierCursor(value: unknown): value is ScopedTierCursor {
  return (
    hasExactKeys(value, ['tier', 'id', 'scope']) &&
    hasFiniteNumberAndStrings(value, 'tier', 'id', 'scope')
  )
}
export function isScopedAliasCursor(value: unknown): value is ScopedAliasCursor {
  return hasExactKeys(value, ['alias', 'scope']) && hasStrings(value, 'alias', 'scope')
}
export function isScopedTierPreciseNameCursor(
  value: unknown,
): value is ScopedTierPreciseNameCursor {
  return (
    hasExactKeys(value, ['tier', 'timestamp', 'name', 'scope']) &&
    hasTierTimestampAndStrings(value, 'name', 'scope')
  )
}
export function isScopedTierPreciseUuidCursor(
  value: unknown,
): value is ScopedTierPreciseUuidCursor {
  return (
    hasExactKeys(value, ['timestamp', 'tier', 'id', 'scope']) &&
    hasTierTimestampAndStrings(value, 'id', 'scope')
  )
}

function hasStrings(value: Record<string, unknown>, ...keys: string[]): boolean {
  return keys.every((key) => typeof value[key] === 'string')
}
function hasFiniteNumberAndStrings(
  value: Record<string, unknown>,
  numberKey: string,
  ...stringKeys: string[]
): boolean {
  return (
    typeof value[numberKey] === 'number' &&
    Number.isFinite(value[numberKey]) &&
    hasStrings(value, ...stringKeys)
  )
}
function hasSafeTimestampAndStrings(
  value: Record<string, unknown>,
  timestampKey: string,
  ...stringKeys: string[]
): boolean {
  const timestamp = value[timestampKey]
  return (
    typeof timestamp === 'number' &&
    Number.isSafeInteger(timestamp) &&
    timestamp >= -8_640_000_000_000_000 &&
    timestamp <= 8_640_000_000_000_000 &&
    hasStrings(value, ...stringKeys)
  )
}
function hasPreciseTimestampAndStrings(
  value: Record<string, unknown>,
  timestampKey: string,
  ...stringKeys: string[]
): boolean {
  return (
    typeof value[timestampKey] === 'string' &&
    isPreciseTimestampString(value[timestampKey]) &&
    hasStrings(value, ...stringKeys)
  )
}
function hasTierTimestampAndStrings(
  value: Record<string, unknown>,
  ...stringKeys: string[]
): boolean {
  return (
    typeof value.tier === 'number' &&
    Number.isSafeInteger(value.tier) &&
    typeof value.timestamp === 'string' &&
    isPreciseTimestampString(value.timestamp) &&
    hasStrings(value, ...stringKeys)
  )
}
