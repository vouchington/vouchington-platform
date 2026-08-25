export type NumberFormatLocale = string | string[]
const numbers = new Map<string, Intl.NumberFormat>()
const compact = new Map<string, Intl.NumberFormat>()
const dates = new Map<string, Intl.DateTimeFormat>()
const key = (locale: NumberFormatLocale) => (Array.isArray(locale) ? locale.join('\0') : locale)
export function formatNumber(value: number, locale: NumberFormatLocale = 'en'): string {
  const cacheKey = key(locale)
  const formatter =
    numbers.get(cacheKey) ?? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 })
  numbers.set(cacheKey, formatter)
  return formatter.format(value)
}
export function formatCompactNumber(value: number, locale: NumberFormatLocale = 'en'): string {
  const cacheKey = `${key(locale)}:${value >= 1_000_000_000 ? 1 : 0}`
  const formatter =
    compact.get(cacheKey) ??
    new Intl.NumberFormat(locale, {
      notation: 'compact',
      maximumFractionDigits: 1,
      minimumFractionDigits: value >= 1_000_000_000 ? 1 : 0,
    })
  compact.set(cacheKey, formatter)
  return formatter.format(value)
}
export function formatUtcDate(value: string, locale = 'en-US'): string {
  const formatter =
    dates.get(locale) ??
    new Intl.DateTimeFormat(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      timeZone: 'UTC',
    })
  dates.set(locale, formatter)
  return formatter.format(new Date(value))
}
export function generateExcerpt(markdown: string, maximumLength = 200): string {
  const text = markdown
    .replaceAll(/#{1,6}\s+/g, '')
    .replaceAll(/\*\*([^*]+)\*\*/g, '$1')
    .replaceAll(/\*([^*]+)\*/g, '$1')
    .replaceAll(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replaceAll(/`([^`]+)`/g, '$1')
    .replaceAll(/\n+/g, ' ')
    .trim()
  if (text.length <= maximumLength) return text
  const truncated = text.slice(0, maximumLength)
  const boundary = truncated.lastIndexOf(' ')
  return `${boundary > 0 ? truncated.slice(0, boundary) : truncated}...`
}
export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}
export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`
  return `${(value / 1024 ** 3).toFixed(2)} GB`
}
export function formatDuration(seconds: number): string {
  const total = Math.floor(seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const remainder = total % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remainder).padStart(2, '0')}`
}
