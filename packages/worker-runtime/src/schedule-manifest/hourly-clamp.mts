import type { ScheduledJobRepeat } from './types.mts'

/**
 * A database or service that auto-pauses needs a contiguous idle window, and every wake costs a
 * resume. A low-traffic environment can therefore rewrite every scheduled job (through
 * `transformRepeat`) so it fires at most once per hour, and only at minute :00 UTC, so all jobs
 * share one wake per hour instead of each keeping its own minute.
 *
 * A glide-mq `every` schedule keeps the phase of its first upsert, so unaligned `every` jobs drift
 * onto different minutes, and a single-minute cron such as `17 * * * *` pins its own minute. Both
 * are rewritten to a cron pattern whose minute field is `0`.
 */
const HOURLY_FLOOR_MS = 3_600_000
const HOURLY_FLOOR_PATTERN = '0 * * * *'
const HOURLY_FLOOR_SCHEDULE_TEXT = 'every 1h'

const WAKE_MINUTE_FIELD = '0'
const DAILY_PATTERN = '0 0 * * *'
const WEEKLY_PATTERN = '0 0 * * 0'
const MONTHLY_PATTERN = '0 0 1 * *'
const HOURS_PER_DAY = 24
const HOURS_PER_WEEK = 168
// The hour steps that divide 24 evenly, so the cron fires on the same hours every day.
const DAY_ALIGNED_HOUR_STEPS = [2, 3, 4, 6, 8, 12, 24] as const

export type HourlyClampResult =
  | { repeat: ScheduledJobRepeat; clamped: false }
  | { repeat: { pattern: string }; clamped: true }

/**
 * Aligns a resolved (non-thunk) repeat to the hourly wake. A cron pattern whose minute field is
 * already `0` is returned unchanged (same reference), so callers can cheaply detect a rewrite via
 * the `clamped` flag.
 *
 * - `every` at or below one hour becomes `0 * * * *`.
 * - `every` above one hour rounds up to the next cadence that stays at :00 and does not fire more
 *   often than declared: the smallest of 2, 3, 4, 6, 8, 12 or 24 hours that is at least the
 *   declared interval (an hour-step cron: minute 0 of every Nth hour; `0 0 * * *` for 24 hours),
 *   then weekly (`0 0 * * 0`) up to 7 days, then monthly (`0 0 1 * *`). Monthly is the least
 *   frequent rung, so an interval longer than a month is capped there; a longer interval is not expected.
 * - A cron pattern keeps its hour, day-of-month, month and day-of-week fields and has its minute
 *   field replaced with `0`, so it never fires more than once in an hour it runs.
 */
export function clampScheduledJobRepeatToHourlyFloor(
  repeat: ScheduledJobRepeat,
): HourlyClampResult {
  if ('every' in repeat) {
    return { repeat: { pattern: alignedEveryPattern(repeat.every) }, clamped: true }
  }
  const pattern = alignedCronPattern(repeat.pattern)
  return pattern === repeat.pattern
    ? { repeat, clamped: false }
    : { repeat: { pattern }, clamped: true }
}

/**
 * Operator-facing schedule text for an aligned pattern: the top-of-hour pattern reads `every 1h`,
 * an hour-step pattern reads `every Nh`, and any other pattern is shown as the cron itself.
 */
export function alignedScheduleText(pattern: string): string {
  if (pattern === HOURLY_FLOOR_PATTERN) return HOURLY_FLOOR_SCHEDULE_TEXT
  const hourStep = /^0 \*\/(\d+) \* \* \*$/.exec(pattern)?.[1]
  return hourStep === undefined ? pattern : `every ${hourStep}h`
}

function alignedEveryPattern(everyMs: number): string {
  const hours = everyMs / HOURLY_FLOOR_MS
  if (hours <= 1) return HOURLY_FLOOR_PATTERN
  if (hours <= HOURS_PER_DAY) {
    const step = DAY_ALIGNED_HOUR_STEPS.find((candidate) => candidate >= hours)!
    return step === HOURS_PER_DAY ? DAILY_PATTERN : `0 */${step} * * *`
  }
  return hours <= HOURS_PER_WEEK ? WEEKLY_PATTERN : MONTHLY_PATTERN
}

function alignedCronPattern(pattern: string): string {
  const [minuteField, ...rest] = pattern.trim().split(/\s+/)
  if (minuteField === undefined || minuteField === '' || rest.length !== 4) {
    throw new Error(`Expected a 5-field cron pattern, got: ${JSON.stringify(pattern)}`)
  }
  if (minuteField === WAKE_MINUTE_FIELD) return pattern
  // Validate before replacing: rewriting must not turn a malformed minute field into a valid one,
  // or the rewrite would register a manifest that GlideMQ rejects.
  assertValidCronMinuteField(minuteField, pattern)
  return [WAKE_MINUTE_FIELD, ...rest].join(' ')
}

// Mirrors the minute grammar GlideMQ accepts: comma-separated `*`, `N` or `N-M`, each with an
// optional `/step`, where `N/step` runs from N to 59.
function assertValidCronMinuteField(minuteField: string, pattern: string): void {
  for (const item of minuteField.split(',')) {
    const match = /^(?:\*|(\d+)(?:-(\d+))?)(?:\/(\d+))?$/.exec(item)
    const [from, to, step] = [match?.[1], match?.[2], match?.[3]].map((value) =>
      value === undefined ? undefined : Number(value),
    )
    const outOfRange = (from ?? 0) > 59 || (to ?? 0) > 59 || (from ?? 0) > (to ?? 59)
    if (match === null || step === 0 || outOfRange) {
      throw new Error(
        `Invalid cron minute field ${JSON.stringify(minuteField)} in pattern ${JSON.stringify(pattern)}`,
      )
    }
  }
}
