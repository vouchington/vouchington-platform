const MAX_POSTGRES_BIGINT = BigInt('9223372036854775807')
export function parsePositivePostgresBigint(value: unknown): string | null {
  if (typeof value === 'number')
    return Number.isSafeInteger(value) && value > 0 ? String(value) : null
  return typeof value === 'string' &&
    /^[1-9]\d*$/.test(value) &&
    value.length <= 19 &&
    BigInt(value) <= MAX_POSTGRES_BIGINT
    ? value
    : null
}
export function parsePositivePostgresBigintParam(
  query: Record<string, unknown>,
  key: string,
): string | undefined {
  return query[key] === undefined
    ? undefined
    : (parsePositivePostgresBigint(query[key]) ?? undefined)
}
