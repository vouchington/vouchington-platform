import { compareCodePoints } from './compare.mts'
import { LOCALIZATION_WIRE_CONTRACT } from './types.mts'
import { canonicalJson } from './serialize.mts'
import type { LocalizationBatch, LocalizationLeaf } from './types.mts'

export function serializeLocalizationBatch(batch: LocalizationBatch): string {
  return canonicalJson({
    contract: batch.contract,
    messages: Object.fromEntries(
      Object.entries(batch.messages).toSorted(([left], [right]) => compareCodePoints(left, right)),
    ),
    revision: batch.revision,
    ttlSeconds: batch.ttlSeconds,
  })
}

export function localizationEtag(revision: string): string {
  return `"${revision}"`
}

export function etagMatches(header: string | null | undefined, revision: string): boolean {
  if (header == null || header.trim() === '') return false
  const expected = localizationEtag(revision)
  return header
    .split(',')
    .some((value) => value.trim() === expected || value.trim() === `W/${expected}`)
}

export function createLocalizationBatch(
  revision: string,
  ttlSeconds: number,
  messages: Readonly<Record<string, LocalizationLeaf>>,
): LocalizationBatch {
  if (!Number.isInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new TypeError('ttlSeconds must be a positive integer')
  }
  return {
    contract: LOCALIZATION_WIRE_CONTRACT,
    revision,
    ttlSeconds,
    messages: Object.fromEntries(
      Object.entries(messages).toSorted(([left], [right]) => compareCodePoints(left, right)),
    ),
  }
}
