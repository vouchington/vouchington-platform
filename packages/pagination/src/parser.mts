import createHttpError from 'http-errors'

import { queryInteger, queryString } from './query-contract.mts'
import type {
  PaginationConfig,
  PaginationFilter,
  PaginationFilters,
  PaginationQueryContract,
  ParsedOptions,
  Query,
  QueryContract,
  QueryParameterContract,
} from './types.mts'

type Limit = {
  readonly paramName: string
  readonly min: number
  readonly max: number
  readonly default: number
}
type Filter = {
  readonly outputName: string
  readonly queryName: string
  readonly queryContract: QueryParameterContract
  readonly parse: PaginationFilter<unknown>['parse']
}
type Config = {
  readonly cursorName: string
  readonly legacyCursorNames: readonly string[]
  readonly limit: Limit
  readonly filters: readonly Filter[]
}

export class PaginationParser<TConfig extends PaginationConfig> {
  readonly queryContract: PaginationQueryContract<TConfig>
  readonly #config: Config

  constructor(config: TConfig) {
    this.#config = snapshotConfig(config)
    this.queryContract = buildQueryContract(this.#config) as PaginationQueryContract<TConfig>
  }

  parse(query: Query): ParsedOptions<TConfig> {
    const legacyName = this.#config.legacyCursorNames.find((name) => query[name] !== undefined)
    const cursorName =
      query[this.#config.cursorName] === undefined ? legacyName : this.#config.cursorName
    const result: Record<string, unknown> = Object.create(null)
    result.limit = parseBoundedIntegerLimit(query[this.#config.limit.paramName], this.#config.limit)
    if (cursorName !== undefined) {
      const cursor = query[cursorName]
      if (typeof cursor !== 'string') throw createHttpError(400, `${cursorName} must be a string`)
      if (cursor === '') throw createHttpError(400, `${cursorName} cannot be empty`)
      result.after = cursor
    }
    for (const filter of this.#config.filters) {
      const parsed = filter.parse(query[filter.queryName], query)
      if (parsed !== undefined) result[filter.outputName] = parsed
    }
    return result as ParsedOptions<TConfig>
  }
}

export function createPaginationParser<
  const TFilters extends PaginationFilters = {},
  const TCursorName extends string = string,
  const TLimitName extends string = string,
  const TMinimum extends number = number,
  const TMaximum extends number = number,
  const TDefault extends number = number,
>(
  config: PaginationConfig<TFilters, TCursorName, TLimitName, TMinimum, TMaximum, TDefault>,
): PaginationParser<
  PaginationConfig<TFilters, TCursorName, TLimitName, TMinimum, TMaximum, TDefault>
> {
  return new PaginationParser(config)
}
export function parseBoundedIntegerLimit(value: unknown, bounds: Limit): number {
  if (value === undefined) return bounds.default
  const parsed =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value)
        ? Number(value)
        : Number.NaN
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw createHttpError(400, 'limit must be a positive integer')
  return Math.max(bounds.min, Math.min(bounds.max, parsed))
}

function snapshotConfig(config: PaginationConfig): Config {
  const cursor = config.cursor
  const limit = config.limit
  if (cursor.legacyParamNames !== undefined && !Array.isArray(cursor.legacyParamNames))
    throw new TypeError('legacy cursor parameter names must be an array')
  const legacyCursorNames =
    cursor.legacyParamNames === undefined ? [] : [...cursor.legacyParamNames]
  const sourceFilters = config.filters as Record<string, PaginationFilter<unknown>> | undefined
  const filters = Object.entries(sourceFilters ?? {}).map(([outputName, filter]) => ({
    outputName,
    queryName: filter.queryName,
    queryContract: cloneDescriptor(filter.queryContract),
    parse: filter.parse,
  }))
  validateConfig(cursor.paramName, legacyCursorNames, limit, filters)
  return Object.freeze({
    cursorName: cursor.paramName,
    legacyCursorNames: Object.freeze(legacyCursorNames),
    limit: Object.freeze({ ...limit }),
    filters: Object.freeze(filters.map((filter) => Object.freeze(filter))),
  })
}
function validateConfig(
  cursorName: unknown,
  aliases: readonly unknown[],
  limit: unknown,
  filters: readonly Filter[],
): void {
  if (!isLimit(limit))
    throw new TypeError('limit bounds must be positive safe integers with min <= default <= max')
  const names = [
    cursorName,
    limit.paramName,
    ...aliases,
    ...filters.map((filter) => filter.queryName),
  ]
  if (names.some((name) => !isSafeName(name)))
    throw new TypeError('query parameter names must be safe non-empty strings')
  if (new Set(names).size !== names.length)
    throw new TypeError('query parameter names must be distinct')
  for (const filter of filters) {
    if (
      !isSafeName(filter.outputName) ||
      filter.outputName === 'limit' ||
      filter.outputName === 'after'
    )
      throw new TypeError('filter output names must be safe and cannot be reserved parsed keys')
  }
}
function buildQueryContract(config: Config): QueryContract {
  const contract: Record<string, QueryParameterContract> = Object.create(null)
  contract[config.cursorName] = queryString()
  contract[config.limit.paramName] = queryInteger({
    minimum: config.limit.min,
    maximum: config.limit.max,
    default: config.limit.default,
  })
  for (const filter of config.filters) contract[filter.queryName] = filter.queryContract
  return Object.freeze(contract)
}
function isLimit(value: unknown): value is Limit {
  if (typeof value !== 'object' || value === null) return false
  const { min, max, default: defaultLimit } = value as Record<string, unknown>
  return (
    [min, max, defaultLimit].every(Number.isSafeInteger) &&
    (min as number) > 0 &&
    (min as number) <= (max as number) &&
    (defaultLimit as number) >= (min as number) &&
    (defaultLimit as number) <= (max as number) &&
    isSafeName((value as Record<string, unknown>).paramName)
  )
}
function isSafeName(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    !/[\p{White_Space}\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/u.test(value) &&
    !['__proto__', 'prototype', 'constructor'].includes(value)
  )
}
function cloneDescriptor(value: QueryParameterContract): QueryParameterContract {
  return freezeValue(value) as QueryParameterContract
}
function freezeValue(value: unknown): unknown {
  if (Array.isArray(value)) return Object.freeze(value.map(freezeValue))
  if (typeof value === 'object' && value !== null) {
    const copy: Record<string, unknown> = Object.create(null)
    for (const [key, child] of Object.entries(value)) copy[key] = freezeValue(child)
    return Object.freeze(copy)
  }
  return value
}
