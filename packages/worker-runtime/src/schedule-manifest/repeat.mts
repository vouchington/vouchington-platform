import type { ScheduledJobRepeat } from './types.mts'

/** No scheduled job may repeat faster than this without an explicit `subMinuteJustification`. */
export const SCHEDULING_FLOOR_MS = 60_000

export function assertNonEmptyString(value: unknown, field: string): void {
  if (typeof value !== 'string') throw new Error(`${field} must be a string`)
  if (value.trim() === '') throw new Error(`${field} must be a nonempty string`)
  if (value !== value.trim()) throw new Error(`${field} must not have surrounding whitespace`)
}

/**
 * Validates one resolved repeat: exactly one of a 5-field cron `pattern` or a positive finite
 * `every` that meets the scheduling floor (or carries a justification).
 */
export function validateScheduledJobRepeat(
  repeat: ScheduledJobRepeat,
  schedulerKey: string,
  justification?: string,
): void {
  const hasPattern = 'pattern' in repeat
  if (hasPattern === 'every' in repeat) {
    throw new Error(`${schedulerKey} repeat must define exactly one of pattern or every`)
  }
  if (hasPattern) {
    assertNonEmptyString(repeat.pattern, `${schedulerKey} repeat pattern`)
    // glide-mq's cron evaluator only parses exactly 5 whitespace-separated fields.
    const fieldCount = repeat.pattern.trim().split(/\s+/).length
    if (fieldCount !== 5) {
      throw new Error(
        `${schedulerKey} repeat pattern must be a 5-field cron pattern (got ${fieldCount} fields); ` +
          'seconds-precision cron patterns are not supported',
      )
    }
    return
  }
  if (!Number.isFinite(repeat.every) || repeat.every <= 0) {
    throw new Error(`${schedulerKey} repeat every must be a positive finite number`)
  }
  if (repeat.every >= SCHEDULING_FLOOR_MS) return
  if (justification !== undefined && justification.trim() !== '') return
  throw new Error(
    `${schedulerKey} repeat every ${repeat.every}ms is below the ${SCHEDULING_FLOOR_MS}ms scheduling ` +
      'floor; set subMinuteJustification on the job definition to explain why this cadence is required',
  )
}
