/** UTC only, optional milliseconds: a time without a zone or with an offset is not a window edge. */
const UTC_ISO_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/

/**
 * A report-window edge as an instant, or null when the text is not exactly a UTC ISO time such as
 * `2026-10-01T00:00:00Z`. `Date` rolls impossible dates over and reads bare numbers, either of
 * which would silently move the window, so the instant must print back as the same text.
 */
export function parseUtcIsoTime(value: string): Date | null {
  if (!UTC_ISO_TIME.test(value)) return null
  const time = new Date(value)
  if (Number.isNaN(time.getTime())) return null
  const [seconds = '', fraction = ''] = value.slice(0, -1).split('.')
  return time.toISOString() === `${seconds}.${fraction.padEnd(3, '0')}Z` ? time : null
}
