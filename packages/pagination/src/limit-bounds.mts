export type LimitBounds = { readonly min: number; readonly max: number; readonly default: number }

/**
 * Narrows static limit bounds with runtime-supplied `max` and `default` (for example from live
 * configuration). The runtime maximum is clamped into the static `[min, max]` range, and the
 * runtime default is clamped into `[min, narrowedMax]`, so runtime values can never widen what the
 * static contract advertises.
 */
export function narrowLimitBounds<TBounds extends LimitBounds>(
  bounds: TBounds,
  runtime?: { readonly max: number; readonly default: number },
): Omit<TBounds, 'max' | 'default'> & { readonly max: number; readonly default: number } {
  if (!runtime) return bounds
  const max = Math.max(bounds.min, Math.min(bounds.max, runtime.max))
  return { ...bounds, max, default: Math.max(bounds.min, Math.min(max, runtime.default)) }
}
