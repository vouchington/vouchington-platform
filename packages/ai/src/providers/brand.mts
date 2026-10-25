/**
 * True when `value` is an `Error` carrying `brand`, which every installed copy of this package
 * sets alike. Package copies share the realm's `Error`, so a branded plain object is rejected.
 */
export function hasBrand(value: unknown, brand: symbol): boolean {
  return value instanceof Error && (value as unknown as Record<symbol, unknown>)[brand] === true
}

/**
 * `Symbol.hasInstance` for a branded error class: the class itself matches by brand, so
 * `instanceof` works across package copies; subclasses keep prototype-based checks.
 */
export function brandedHasInstance(
  base: unknown,
  brand: symbol,
  target: unknown,
  value: unknown,
): boolean {
  if (target !== base) return Function.prototype[Symbol.hasInstance].call(target, value)
  return hasBrand(value, brand)
}
