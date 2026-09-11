import { compareCodePoints } from './compare.mts'

const PLACEHOLDER = /\{([\w.-]+)\}/g

export function placeholdersIn(value: string): string[] {
  return [...value.matchAll(PLACEHOLDER)].map((match) => match[1]!).toSorted(compareCodePoints)
}

export function uniquePlaceholders(values: readonly string[]): string[] {
  return [...new Set(values.flatMap(placeholdersIn))].toSorted(compareCodePoints)
}

export function assertSamePlaceholders(
  canonical: readonly string[],
  other: readonly string[],
  path: string,
): void {
  if (canonical.join(',') !== other.join(',')) {
    throw new TypeError(`Placeholder mismatch at "${path}"`)
  }
}
