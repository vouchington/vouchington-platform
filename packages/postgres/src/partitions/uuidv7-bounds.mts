const MAX_TIMESTAMP_MS = 0xffff_ffff_ffff
const DAY_MS = 24 * 60 * 60 * 1000
const UTC_DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/u

/** Smallest UUIDv7 whose embedded 48-bit millisecond timestamp is `timestampMs`. */
export function timestampToUuidv7LowerBound(timestampMs: number): string {
  if (!Number.isInteger(timestampMs) || timestampMs < 0 || timestampMs > MAX_TIMESTAMP_MS) {
    throw new Error('UUIDv7 timestamp must be an integer within the unsigned 48-bit range')
  }
  const hex = timestampMs.toString(16).padStart(12, '0')
  return `${hex.slice(0, 8)}-${hex.slice(8)}-7000-8000-000000000000`
}

/** Half-open `[startBound, endBound)` UUIDv7 range covering one UTC `YYYY-MM-DD` day. */
export function getUtcDayUuidv7Bounds(day: string): { startBound: string; endBound: string } {
  const startMs = UTC_DAY_PATTERN.test(day) ? Date.parse(`${day}T00:00:00.000Z`) : Number.NaN
  if (Number.isNaN(startMs) || new Date(startMs).toISOString().slice(0, 10) !== day) {
    throw new Error(`Invalid UTC day: ${day}`)
  }
  return {
    startBound: timestampToUuidv7LowerBound(startMs),
    endBound: timestampToUuidv7LowerBound(startMs + DAY_MS),
  }
}
