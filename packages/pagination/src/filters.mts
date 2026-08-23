import type {
  PaginationFilter,
  QueryCsvArrayContract,
  QueryEnumContract,
  QueryStringContract,
} from './types.mts'

export function enumFilter<
  const TQueryName extends string,
  const TValues extends readonly string[],
>(
  queryName: TQueryName,
  values: TValues,
): PaginationFilter<TValues[number], TQueryName, QueryEnumContract<TValues>> {
  const catalog = Object.freeze([...values]) as TValues
  return {
    queryName,
    queryContract: { kind: 'enum', values: catalog },
    parse(value) {
      return typeof value === 'string' && catalog.includes(value)
        ? (value as TValues[number])
        : undefined
    },
  }
}
export function csvEnumFilter<
  const TQueryName extends string,
  const TValues extends readonly string[],
>(
  queryName: TQueryName,
  values: TValues,
): PaginationFilter<
  TValues[number][],
  TQueryName,
  QueryCsvArrayContract<QueryEnumContract<TValues>>
> {
  const catalog = Object.freeze([...values]) as TValues
  return {
    queryName,
    queryContract: {
      kind: 'csv-array',
      items: { kind: 'enum', values: catalog },
      style: 'form',
      explode: false,
    },
    parse(value) {
      const entries = Array.isArray(value)
        ? value.flatMap((item) => (typeof item === 'string' ? item.split(',') : []))
        : typeof value === 'string'
          ? value.split(',')
          : []
      const valid = entries
        .map((entry) => entry.trim())
        .filter((entry): entry is TValues[number] => catalog.includes(entry))
      return valid.length === 0 ? undefined : [...new Set(valid)]
    },
  }
}
export function stringFilter<const TQueryName extends string>(
  queryName: TQueryName,
): PaginationFilter<string, TQueryName, QueryStringContract> {
  return {
    queryName,
    queryContract: { kind: 'string' },
    parse(value) {
      return typeof value === 'string' ? value : undefined
    },
  }
}
