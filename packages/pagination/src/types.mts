export type SimpleCursor = { id: string }
export type ScopedSimpleCursor = SimpleCursor & { scope: string }
export type ScoreCursor = SimpleCursor & { score: number }
export type ScopedScoreCursor = ScoreCursor & { scope: string }
export type RankingCursor = SimpleCursor & { ranking: number }
export type TimestampCursor = SimpleCursor & { timestamp: number }
export type ScopedTimestampCursor = TimestampCursor & { scope: string }
export type PreciseTimestampCursor = SimpleCursor & { timestamp: string }
export type ScopedPreciseTimestampCursor = PreciseTimestampCursor & { scope: string }
export type NameCursor = SimpleCursor & { name: string }
export type TierCursor = SimpleCursor & { tier: number }
export type ScopedTierCursor = TierCursor & { scope: string }
export type ScopedAliasCursor = { alias: string; scope: string }
export type ScopedTierPreciseNameCursor = {
  tier: number
  timestamp: string
  name: string
  scope: string
}
export type ScopedTierPreciseUuidCursor = PreciseTimestampCursor & { tier: number; scope: string }
export type Cursor = Record<string, unknown>

type LiteralOption<TKey extends PropertyKey, TValue> = [TValue] extends [undefined]
  ? {}
  : [undefined] extends [TValue]
    ? { readonly [TProperty in TKey]?: Exclude<TValue, undefined> }
    : { readonly [TProperty in TKey]: TValue }
type Description<TDescription extends string | undefined> = LiteralOption<
  'description',
  TDescription
>

export type QueryStringContract<
  TFormat extends 'uuid' | 'uri' | undefined = undefined,
  TDescription extends string | undefined = undefined,
> = { readonly kind: 'string' } & LiteralOption<'format', TFormat> & Description<TDescription>
export type QueryBooleanContract<TDescription extends string | undefined = undefined> = {
  readonly kind: 'boolean'
} & Description<TDescription>
export type QueryNullableBooleanContract<TDescription extends string | undefined = undefined> = {
  readonly kind: 'nullable-boolean'
} & Description<TDescription>
export type QueryNumberContract<TDescription extends string | undefined = undefined> = {
  readonly kind: 'number'
} & Description<TDescription>
export type QueryUuidOrUriContract<TDescription extends string | undefined = undefined> = {
  readonly kind: 'uuid-or-uri'
} & Description<TDescription>
export type QueryIntegerContract<
  TMinimum extends number = number,
  TMaximum extends number = number,
  TDefault extends number | undefined = undefined,
  TDescription extends string | undefined = undefined,
> = {
  readonly kind: 'integer'
  readonly minimum: TMinimum
  readonly maximum: TMaximum
} & LiteralOption<'default', TDefault> &
  Description<TDescription>
export type QueryEnumContract<
  TValues extends readonly string[] = readonly string[],
  TDescription extends string | undefined = undefined,
  TDefault extends TValues[number] | undefined = undefined,
> = { readonly kind: 'enum'; readonly values: Readonly<TValues> } & Description<TDescription> &
  LiteralOption<'default', TDefault>
export type QueryArrayItemContract =
  | QueryStringContract<'uuid' | 'uri' | undefined, string | undefined>
  | QueryEnumContract<readonly string[], string | undefined, string | undefined>
export type QueryCsvArrayContract<
  TItems extends QueryArrayItemContract = QueryArrayItemContract,
  TDescription extends string | undefined = undefined,
> = {
  readonly kind: 'csv-array'
  readonly items: TItems
  readonly style: 'form'
  readonly explode: false
} & Description<TDescription>
export type QueryParameterContract =
  | QueryStringContract<'uuid' | 'uri' | undefined, string | undefined>
  | QueryBooleanContract<string | undefined>
  | QueryNullableBooleanContract<string | undefined>
  | QueryNumberContract<string | undefined>
  | QueryUuidOrUriContract<string | undefined>
  | QueryIntegerContract<number, number, number | undefined, string | undefined>
  | QueryEnumContract<readonly string[], string | undefined, string | undefined>
  | QueryCsvArrayContract<QueryArrayItemContract, string | undefined>
export type QueryContract = Readonly<Record<string, QueryParameterContract>>
export type QueryContractCarrier<TContract extends QueryContract = QueryContract> = {
  readonly queryContract: TContract
}
export type AnyQueryContractCarrier = {
  readonly queryContract: Readonly<Record<string, unknown>>
}
export type ValidatedQueryContractCarriers<TSources extends readonly AnyQueryContractCarrier[]> = {
  readonly [TIndex in keyof TSources]: TSources[TIndex] extends {
    readonly queryContract: infer TContract
  }
    ? TContract extends QueryContract
      ? TSources[TIndex]
      : never
    : never
}

export type Query = Readonly<Record<string, unknown>>
export type PaginationFilter<
  TValue,
  TQueryName extends string = string,
  TContract extends QueryParameterContract = QueryParameterContract,
> = {
  readonly queryName: TQueryName
  readonly queryContract: TContract
  readonly parse: (value: unknown, query: Query) => TValue | undefined
}
export type PaginationFilters = Readonly<Record<string, PaginationFilter<unknown>>>
export type PaginationConfig<
  TFilters extends PaginationFilters = {},
  TCursorName extends string = string,
  TLimitName extends string = string,
  TMinimum extends number = number,
  TMaximum extends number = number,
  TDefault extends number = number,
> = {
  readonly cursor: {
    readonly paramName: TCursorName
    readonly legacyParamNames?: readonly string[]
  }
  readonly limit: {
    readonly paramName: TLimitName
    readonly min: TMinimum
    readonly max: TMaximum
    readonly default: TDefault
  }
  readonly filters?: TFilters
}
type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer TResult,
) => void
  ? TResult
  : never
type FilterQueryContract<TFilters> = TFilters extends object
  ? UnionToIntersection<
      {
        [TKey in keyof TFilters]: TFilters[TKey] extends {
          readonly queryName: infer TName extends string
          readonly queryContract: infer TContract extends QueryParameterContract
        }
          ? { readonly [TParameter in TName]: TContract }
          : never
      }[keyof TFilters]
    >
  : {}
type ConfiguredValue<TValue, TKey extends PropertyKey> =
  TValue extends Record<TKey, infer TResult> ? Exclude<TResult, undefined> : never
type ConfiguredFilters<TConfig extends PaginationConfig> =
  TConfig extends PaginationConfig<infer TFilters, string, string, number, number, number>
    ? TFilters
    : never
export type PaginationQueryContract<TConfig extends PaginationConfig> = {
  readonly [TName in ConfiguredValue<TConfig['cursor'], 'paramName'> & string]: QueryStringContract
} & {
  readonly [TName in ConfiguredValue<TConfig['limit'], 'paramName'> & string]: QueryIntegerContract<
    ConfiguredValue<TConfig['limit'], 'min'> & number,
    ConfiguredValue<TConfig['limit'], 'max'> & number,
    ConfiguredValue<TConfig['limit'], 'default'> & number
  >
} & FilterQueryContract<ConfiguredFilters<TConfig>>
export type ParsedOptions<TConfig extends PaginationConfig> = {
  readonly limit: number
  readonly after?: string
} & (TConfig['filters'] extends PaginationFilters
  ? { readonly [TKey in keyof TConfig['filters']]?: ReturnType<TConfig['filters'][TKey]['parse']> }
  : {})
