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
  const byAlias = new Map<
    string,
    {
      descriptor: ReturnType<typeof parseDescriptor>
      translations: Record<string, TranslationValue>
    }
  >()
  for (const row of rows) {
    const current = byAlias.get(row.alias) ?? {
      descriptor: parseDescriptor(JSON.parse(row.descriptor_json)),
      translations: {},
    }
    current.translations[row.locale] = JSON.parse(row.value_json) as TranslationValue
    byAlias.set(row.alias, current)
  }
  const messages: Record<string, LocalizationLeaf> = {}
  for (const alias of [...byAlias.keys()].toSorted(compareCodePoints)) {
    const entry = byAlias.get(alias)!
    const value = firstAvailableTranslation(normalized.locales, entry.translations)
    if (value === undefined) continue
    messages[alias] = leafForTranslation(entry.descriptor, value)
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
      ? `EXPLAIN QUERY PLAN SELECT a.alias FROM consumer_aliases a WHERE a.consumer = 'web' AND a.alias = ?`
      : `EXPLAIN QUERY PLAN SELECT r.alias FROM route_membership r WHERE r.consumer = 'web' AND r.selector_id >= ? AND r.selector_id < ?`
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
): Array<{ alias: string; locale: string; descriptor_json: string; value_json: string }> {
  const exact = database.sqlite.prepare(
    `SELECT DISTINCT a.alias, t.locale, c.descriptor_json, t.value_json
     FROM consumer_aliases a JOIN copies c ON c.id = a.copy_id
     JOIN translations t ON t.copy_id = c.id
     WHERE a.consumer = ? AND a.alias = ?
     UNION
     SELECT a.alias, t.locale, c.descriptor_json, t.value_json
     FROM route_membership r JOIN consumer_aliases a ON a.consumer = r.consumer AND a.alias = r.alias
     JOIN copies c ON c.id = a.copy_id JOIN translations t ON t.copy_id = c.id
     WHERE r.consumer = ? AND r.selector_id = ?`,
  )
  const prefix = database.sqlite.prepare(
    `SELECT DISTINCT a.alias, t.locale, c.descriptor_json, t.value_json
     FROM route_membership r JOIN consumer_aliases a ON a.consumer = r.consumer AND a.alias = r.alias
     JOIN copies c ON c.id = a.copy_id JOIN translations t ON t.copy_id = c.id
     WHERE r.consumer = ? AND r.selector_id >= ? AND r.selector_id < ?
     UNION
     SELECT a.alias, t.locale, c.descriptor_json, t.value_json
     FROM consumer_aliases a JOIN copies c ON c.id = a.copy_id JOIN translations t ON t.copy_id = c.id
     WHERE a.consumer = ? AND a.alias >= ? AND a.alias < ?`,
  )
  const rows: Array<{
    alias: string
    locale: string
    descriptor_json: string
    value_json: string
  }> = []
  for (const selector of selectors) {
    const found =
      selector.kind === 'exact'
        ? exact.all(consumer, selector.id, consumer, selector.id)
        : prefix.all(
            consumer,
            ...prefixRange(selector.prefix),
            consumer,
            ...prefixRange(selector.prefix),
          )
    rows.push(...(found as typeof rows))
  }
  return rows
}
