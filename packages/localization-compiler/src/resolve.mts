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
  const requested = selectors.map(selectorRow).join(', ')
  const parameters = selectors.flatMap(selectorParameters)
  const statement = database.sqlite.prepare(
    `WITH requested(kind, exact_id, lower_bound, upper_bound) AS (VALUES ${requested}),
     matched_aliases AS (
       SELECT a.alias FROM consumer_aliases a JOIN requested s
         ON s.kind = 'exact' AND a.alias = s.exact_id WHERE a.consumer = ?
       UNION ALL
       SELECT r.alias FROM route_membership r JOIN requested s
         ON s.kind = 'exact' AND r.selector_id = s.exact_id WHERE r.consumer = ?
       UNION ALL
       SELECT a.alias FROM consumer_aliases a JOIN requested s
         ON s.kind = 'prefix' AND a.alias >= s.lower_bound AND a.alias < s.upper_bound
         WHERE a.consumer = ?
       UNION ALL
       SELECT r.alias FROM route_membership r JOIN requested s
         ON s.kind = 'prefix' AND r.selector_id >= s.lower_bound AND r.selector_id < s.upper_bound
         WHERE r.consumer = ?
     ), aliases AS (SELECT DISTINCT alias FROM matched_aliases)
     SELECT a.alias, t.locale, c.descriptor_json, t.value_json
     FROM aliases matched JOIN consumer_aliases a ON a.alias = matched.alias AND a.consumer = ?
     JOIN copies c ON c.id = a.copy_id JOIN translations t ON t.copy_id = c.id`,
  )
  return statement.all(...parameters, consumer, consumer, consumer, consumer, consumer) as Array<{
    alias: string
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
