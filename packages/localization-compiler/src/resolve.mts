import {
  DEFAULT_LOCALIZATION_BOUNDS,
  assertMessageCount,
  assertPayloadBytes,
  canonicalJson,
  compareCodePoints,
  createLocalizationBatch,
  firstAvailableTranslation,
  leafForTranslation,
  normalizeLocalizationRequest,
  parseDescriptor,
  prefixRange,
  serializeLocalizationBatch,
  type LocalizationBounds,
  type LocalizationLeaf,
  type LocalizationRequest,
  type LocalizationSelector,
  type TranslationValue,
} from '@vouchington/localization'
import { DEFAULT_TTL_SECONDS } from './schema.mts'
import type { LocalizationDatabase } from './open.mts'

export function resolveLocalizationBatch(
  database: LocalizationDatabase,
  request: LocalizationRequest,
  options: {
    bounds?: LocalizationBounds
    ttlSeconds?: number
    availableLocales?: readonly string[]
  } = {},
) {
  const normalized = normalizeLocalizationRequest(request, options.availableLocales, options.bounds)
  const rows = loadRows(database, normalized.consumer, normalized.selectors)
  const byId = new Map<
    string,
    {
      descriptor: ReturnType<typeof parseDescriptor>
      translations: Record<string, TranslationValue>
    }
  >()
  for (const row of rows) {
    const current = byId.get(row.id) ?? {
      descriptor: parseDescriptor(JSON.parse(row.descriptor_json)),
      translations: {},
    }
    current.translations[row.locale] = JSON.parse(row.value_json) as TranslationValue
    byId.set(row.id, current)
  }
  const messages: Record<string, LocalizationLeaf> = {}
  for (const id of [...byId.keys()].toSorted(compareCodePoints)) {
    const entry = byId.get(id)!
    const value = firstAvailableTranslation(normalized.locales, entry.translations)
    if (value === undefined) continue
    messages[id] = leafForTranslation(entry.descriptor, value)
  }
  assertMessageCount(Object.keys(messages).length, options.bounds ?? DEFAULT_LOCALIZATION_BOUNDS)
  const batch = createLocalizationBatch(
    database.revision,
    options.ttlSeconds ?? DEFAULT_TTL_SECONDS,
    messages,
  )
  assertPayloadBytes(
    serializeLocalizationBatch(batch),
    options.bounds ?? DEFAULT_LOCALIZATION_BOUNDS,
  )
  return batch
}

export function explainLocalizationPlan(
  database: LocalizationDatabase,
  selector: LocalizationSelector,
): string {
  const sql =
    selector.kind === 'exact'
      ? `EXPLAIN QUERY PLAN SELECT m.id FROM consumer_membership c JOIN messages m ON m.id = c.message_id WHERE c.consumer = 'web' AND m.id = ?`
      : `EXPLAIN QUERY PLAN SELECT m.id FROM consumer_membership c JOIN messages m ON m.id = c.message_id WHERE c.consumer = 'web' AND m.id >= ? AND m.id < ?`
  const statement = database.sqlite.prepare(sql)
  const rows =
    selector.kind === 'exact'
      ? statement.all(selector.id)
      : statement.all(...prefixRange(selector.prefix))
  return rows.map((row) => canonicalJson(row)).join('\n')
}

function loadRows(
  database: LocalizationDatabase,
  consumer: string,
  selectors: readonly LocalizationSelector[],
): Array<{ id: string; locale: string; descriptor_json: string; value_json: string }> {
  const requested = selectors.map(selectorRow).join(', ')
  const parameters = selectors.flatMap(selectorParameters)
  const statement = database.sqlite.prepare(
    `WITH requested(kind, exact_id, lower_bound, upper_bound) AS (VALUES ${requested}),
     matched_ids AS (
       SELECT m.id FROM consumer_membership c JOIN messages m ON m.id = c.message_id
       JOIN requested s ON s.kind = 'exact' AND m.id = s.exact_id WHERE c.consumer = ?
       UNION ALL
       SELECT m.id FROM consumer_membership c JOIN messages m ON m.id = c.message_id
       JOIN requested s ON s.kind = 'prefix' AND m.id >= s.lower_bound AND m.id < s.upper_bound
       WHERE c.consumer = ?
     ), ids AS (SELECT DISTINCT id FROM matched_ids)
     SELECT m.id, t.locale, m.descriptor_json, t.value_json FROM ids
     JOIN messages m ON m.id = ids.id JOIN translations t ON t.message_id = m.id`,
  )
  return statement.all(...parameters, consumer, consumer) as Array<{
    id: string
    locale: string
    descriptor_json: string
    value_json: string
  }>
}

function selectorRow(): string {
  return '(?, ?, ?, ?)'
}

function selectorParameters(selector: LocalizationSelector): readonly string[] {
  if (selector.kind === 'exact') return ['exact', selector.id, '', '']
  return ['prefix', '', ...prefixRange(selector.prefix)]
}
