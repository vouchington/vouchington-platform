import { LocalizationBoundError, DEFAULT_LOCALIZATION_BOUNDS } from './bounds.mts'
import { assertLocalizationConsumer } from './consumers.mts'
import { normalizeLocaleList } from './locales.mts'
import { dedupeSelectors, parseSelector } from './selectors.mts'
import type {
  LocalizationBounds,
  LocalizationRequest,
  NormalizedLocalizationRequest,
} from './types.mts'

export function normalizeLocalizationRequest(
  request: LocalizationRequest,
  availableLocales: readonly string[] | null = null,
  bounds: LocalizationBounds = DEFAULT_LOCALIZATION_BOUNDS,
): NormalizedLocalizationRequest {
  const consumer = assertLocalizationConsumer(request.consumer)
  if (request.locales.length === 0) throw new TypeError('At least one locale is required')
  if (request.locales.length > bounds.maxLocales) {
    throw new LocalizationBoundError(`At most ${bounds.maxLocales} locales are allowed`)
  }
  if (request.selectors.length === 0) throw new TypeError('At least one selector is required')
  if (request.selectors.length > bounds.maxSelectors) {
    throw new LocalizationBoundError(`At most ${bounds.maxSelectors} selectors are allowed`)
  }
  const locales = normalizeLocaleList(request.locales, availableLocales)
  if (locales.length === 0) throw new TypeError('No requested locales are available')
  return {
    consumer,
    locales,
    selectors: dedupeSelectors(request.selectors.map(parseSelector)),
  }
}

export function assertMessageCount(count: number, bounds: LocalizationBounds): void {
  if (count > bounds.maxMessages) {
    throw new LocalizationBoundError(`At most ${bounds.maxMessages} messages are allowed`)
  }
}

export function assertPayloadBytes(payload: string, bounds: LocalizationBounds): void {
  if (byteLength(payload) > bounds.maxBytes) {
    throw new LocalizationBoundError(`Localization payload exceeds ${bounds.maxBytes} bytes`)
  }
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).byteLength
}
