/** True when `value` carries `brand`, which every installed copy of this package sets alike. */
export function hasBrand(value: unknown, brand: symbol): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as Record<symbol, unknown>)[brand] === true
  )
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
