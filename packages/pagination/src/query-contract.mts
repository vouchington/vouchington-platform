import type {
  AnyQueryContractCarrier,
  QueryArrayItemContract,
  QueryBooleanContract,
  QueryContract,
  QueryContractCarrier,
  QueryCsvArrayContract,
  QueryEnumContract,
  QueryIntegerContract,
  QueryNullableBooleanContract,
  QueryNumberContract,
  QueryStringContract,
  QueryUuidOrUriContract,
  ValidatedQueryContractCarriers,
} from './types.mts'

export type * from './types.mts'

type Description<TDescription extends string | undefined> = { readonly description?: TDescription }

export function queryString<
  const TFormat extends 'uuid' | 'uri' | undefined = undefined,
  const TDescription extends string | undefined = undefined,
>(
  options: Description<TDescription> & { readonly format?: TFormat } = {},
): QueryStringContract<TFormat, TDescription> {
  return { kind: 'string', ...options } as unknown as QueryStringContract<TFormat, TDescription>
}
export function queryUuid<const TDescription extends string | undefined = undefined>(
  options: Description<TDescription> = {},
): QueryStringContract<'uuid', TDescription> {
  return { kind: 'string', format: 'uuid', ...options } as unknown as QueryStringContract<
    'uuid',
    TDescription
  >
}
export function queryBoolean<const TDescription extends string | undefined = undefined>(
  options: Description<TDescription> = {},
): QueryBooleanContract<TDescription> {
  return { kind: 'boolean', ...options } as QueryBooleanContract<TDescription>
}
export function queryNullableBoolean<const TDescription extends string | undefined = undefined>(
  options: Description<TDescription> = {},
): QueryNullableBooleanContract<TDescription> {
  return { kind: 'nullable-boolean', ...options } as QueryNullableBooleanContract<TDescription>
}
export function queryNumber<const TDescription extends string | undefined = undefined>(
  options: Description<TDescription> = {},
): QueryNumberContract<TDescription> {
  return { kind: 'number', ...options } as QueryNumberContract<TDescription>
}
export function queryUuidOrUri<const TDescription extends string | undefined = undefined>(
  options: Description<TDescription> = {},
): QueryUuidOrUriContract<TDescription> {
  return { kind: 'uuid-or-uri', ...options } as QueryUuidOrUriContract<TDescription>
}
export function queryInteger<
  const TMinimum extends number,
  const TMaximum extends number,
  const TDefault extends number | undefined = undefined,
  const TDescription extends string | undefined = undefined,
>(
  bounds: { readonly minimum: TMinimum; readonly maximum: TMaximum; readonly default?: TDefault },
  options: Description<TDescription> = {},
): QueryIntegerContract<TMinimum, TMaximum, TDefault, TDescription> {
  return { kind: 'integer', ...bounds, ...options } as QueryIntegerContract<
    TMinimum,
    TMaximum,
    TDefault,
    TDescription
  >
}
export function queryEnum<
  const TValues extends readonly string[],
  const TDescription extends string | undefined = undefined,
  const TDefault extends TValues[number] | undefined = undefined,
>(
  values: TValues,
  options: Description<TDescription> & { readonly default?: TDefault } = {},
): QueryEnumContract<TValues, TDescription, TDefault> {
  return { kind: 'enum', values, ...options } as QueryEnumContract<TValues, TDescription, TDefault>
}
export function queryCsvArray<
  const TItems extends QueryArrayItemContract,
  const TDescription extends string | undefined = undefined,
>(
  items: TItems,
  options: Description<TDescription> = {},
): QueryCsvArrayContract<TItems, TDescription> {
  return {
    kind: 'csv-array',
    items,
    style: 'form',
    explode: false,
    ...options,
  } as QueryCsvArrayContract<TItems, TDescription>
}
export function defineQueryContract<const TContract extends QueryContract>(
  queryContract: TContract,
): QueryContractCarrier<TContract> {
  return { queryContract }
}
type UnionToIntersection<T> = (T extends unknown ? (value: T) => void : never) extends (
  value: infer TResult,
) => void
  ? TResult
  : never
type ComposedQueryContract<TSources extends readonly AnyQueryContractCarrier[]> =
  UnionToIntersection<TSources[number]['queryContract']> extends infer TContract extends
    QueryContract
    ? TContract
    : never
export function composeQueryContracts<const TSources extends readonly AnyQueryContractCarrier[]>(
  ...sources: TSources & ValidatedQueryContractCarriers<TSources>
): QueryContractCarrier<ComposedQueryContract<TSources>> {
  const queryContract: Record<string, unknown> = Object.create(null)
  for (const source of sources as readonly AnyQueryContractCarrier[])
    for (const [name, descriptor] of Object.entries(source.queryContract)) {
      if (Object.hasOwn(queryContract, name))
        throw new TypeError(`Duplicate query parameter contract: ${name}`)
      queryContract[name] = descriptor
    }
  return { queryContract: queryContract as ComposedQueryContract<TSources> }
}
export function withQueryContract<
  TFunction extends (...args: never[]) => unknown,
  const TSources extends readonly AnyQueryContractCarrier[],
>(
  fn: TFunction,
  ...sources: TSources & ValidatedQueryContractCarriers<TSources>
): TFunction & QueryContractCarrier<ComposedQueryContract<TSources>> {
  return Object.assign(fn, composeQueryContracts(...sources)) as TFunction &
    QueryContractCarrier<ComposedQueryContract<TSources>>
}
