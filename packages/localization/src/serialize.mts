import { compareCodePoints } from './compare.mts'

export function canonicalJson(value: unknown): string {
  return stringify(sort(value))
}

function sort(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sort)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value)
      .toSorted(([left], [right]) => compareCodePoints(left, right))
      .map(([key, nested]) => [key, sort(nested)]),
  )
}

function stringify(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value)
  if (typeof value === 'string') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stringify).join(',')}]`
  if (typeof value === 'object') {
    return `{${Object.entries(value)
      .map(([key, nested]) => `${JSON.stringify(key)}:${stringify(nested)}`)
      .join(',')}}`
  }
  throw new TypeError('Cannot serialize localization value')
}
