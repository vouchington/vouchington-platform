import { compareCodePoints } from './compare.mts'
import type { ExactSelector, LocalizationSelector, PrefixSelector } from './types.mts'

const SEGMENT = '[A-Za-z0-9][A-Za-z0-9_-]*'
const MESSAGE_ID = new RegExp(`^${SEGMENT}(?:\\.${SEGMENT})+$`)
const PREFIX_SELECTOR = new RegExp(`^${SEGMENT}(?:\\.${SEGMENT})*\\.\\*$`)

export function isMessageId(value: string): boolean {
  return MESSAGE_ID.test(value)
}

export function parseSelector(value: string): LocalizationSelector {
  if (typeof value !== 'string' || value.length === 0) {
    throw new TypeError('Localization selector must be a non-empty string')
  }
  if (PREFIX_SELECTOR.test(value)) return { kind: 'prefix', prefix: value.slice(0, -2) }
  if (MESSAGE_ID.test(value)) return { kind: 'exact', id: value }
  throw new TypeError(`Invalid localization selector "${value}"`)
}

export function selectorMatches(selector: LocalizationSelector, id: string): boolean {
  return selector.kind === 'exact' ? selector.id === id : id.startsWith(`${selector.prefix}.`)
}

export function prefixRange(prefix: string): readonly [string, string] {
  return [`${prefix}.`, `${prefix}/`]
}

export function dedupeSelectors(
  selectors: readonly LocalizationSelector[],
): LocalizationSelector[] {
  const prefixes = uniquePrefixes(selectors.filter(isPrefix))
  const exact = new Map<string, ExactSelector>()
  for (const selector of selectors) {
    if (selector.kind !== 'exact') continue
    if (prefixes.some((prefix) => selectorMatches(prefix, selector.id))) continue
    exact.set(selector.id, selector)
  }
  return [
    ...prefixes,
    ...[...exact.values()].toSorted((left, right) => compareCodePoints(left.id, right.id)),
  ]
}

function uniquePrefixes(selectors: readonly PrefixSelector[]): PrefixSelector[] {
  const sorted = selectors.toSorted((left, right) => compareCodePoints(left.prefix, right.prefix))
  const prefixes: PrefixSelector[] = []
  for (const selector of sorted) {
    if (
      prefixes.some(
        (prefix) =>
          selector.prefix === prefix.prefix || selector.prefix.startsWith(`${prefix.prefix}.`),
      )
    ) {
      continue
    }
    prefixes.push(selector)
  }
  return prefixes
}

function isPrefix(selector: LocalizationSelector): selector is PrefixSelector {
  return selector.kind === 'prefix'
}
