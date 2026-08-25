const DAY = 86_400_000
const UTC_DAY = /^\d{4}-\d{2}-\d{2}$/

export function getCurrentUtcDay(): string {
  return getUtcDayFromDate(new Date())
}
export function getUtcDayFromDate(date: Date): string {
  return date.toISOString().slice(0, 10)
}
export function enumerateUtcDaysInclusive(startDay: string, endDay: string): string[] {
  const start = getDayStart(startDay)
  const end = getDayStart(endDay)
  const days: string[] = []
  for (let date = start; date <= end; date = new Date(date.getTime() + DAY))
    days.push(getUtcDayFromDate(date))
  return days
}
export function getPreviousUtcDays(
  count: number,
  options?: { includeToday?: boolean; baseDate?: Date },
): string[] {
  if (count <= 0) return []
  const offset = options?.includeToday === false ? 1 : 0
  const date = options?.baseDate ?? new Date()
  return Array.from({ length: count }, (_, index) =>
    getUtcDayFromDate(new Date(date.getTime() - (index + offset) * DAY)),
  )
}
export function getDayBounds(day: string): { startMs: number; endMs: number } {
  const startMs = getDayStart(day).getTime()
  return { startMs, endMs: startMs + DAY }
}
export function parseUtcDay(day: string): { year: string; month: string; day: string } {
  const date = getDayStart(day)
  if (!UTC_DAY.test(day) || getUtcDayFromDate(date) !== day)
    throw new Error(`Invalid UTC day: ${day}`)
  const [year, month, dayOfMonth] = day.split('-')
  return { year: year!, month: month!, day: dayOfMonth! }
}
export function parseDuration(value: unknown): number | null {
  if (typeof value === 'number')
    return Number.isFinite(value) && value >= 0 ? Math.floor(value) : null
  if (typeof value !== 'string' || !value.trim()) return null
  const parts = value.trim().split(':')
  if (!parts.every((part) => /^\d+$/.test(part)) || parts.length > 3) return null
  const values = parts.map(Number)
  return values.length === 1
    ? values[0]!
    : values.length === 2
      ? values[0]! * 60 + values[1]!
      : values[0]! * 3600 + values[1]! * 60 + values[2]!
}
function getDayStart(day: string): Date {
  const date = new Date(`${day}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new Error(`Invalid UTC day: ${day}`)
  return date
}
