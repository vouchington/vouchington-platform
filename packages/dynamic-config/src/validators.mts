import { DynamicConfigValidationError } from './errors.mts'
import type { DynamicConfigFields } from './types.mts'

export function validatePositiveNumberFields(next: DynamicConfigFields): void {
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === 'number' && (!Number.isFinite(value) || value <= 0)) {
      throw new DynamicConfigValidationError(`Field ${key} must be a positive finite number`)
    }
  }
}

export function validatePositiveIntegerFields(next: DynamicConfigFields): void {
  for (const [key, value] of Object.entries(next)) {
    if (typeof value === 'number' && (!Number.isInteger(value) || value <= 0)) {
      throw new DynamicConfigValidationError(`Field ${key} must be a positive integer`)
    }
  }
}

/** Requires `next[field]` to be a number within `[min, max]` (inclusive). */
export function validateNumberRange(
  next: DynamicConfigFields,
  field: string,
  min: number,
  max: number,
): void {
  const value = next[field]
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    throw new DynamicConfigValidationError(
      `Field ${field} must be a number between ${min} and ${max}`,
    )
  }
}

/** Requires `next[field]` to be one of the allowed string values. */
export function validateOneOf(
  next: DynamicConfigFields,
  field: string,
  allowed: readonly string[],
): void {
  const value = next[field]
  if (typeof value !== 'string' || !allowed.includes(value)) {
    throw new DynamicConfigValidationError(`${field}: must be ${allowed.join('|')}`)
  }
}

/** Requires numeric fields to be strictly ascending in the given order. */
export function validateStrictlyAscending(
  next: DynamicConfigFields,
  fields: readonly string[],
): void {
  for (let i = 1; i < fields.length; i += 1) {
    if (!(Number(next[fields[i - 1]!]) < Number(next[fields[i]!]))) {
      throw new DynamicConfigValidationError(`Fields must be ordered: ${fields.join(' < ')}`)
    }
  }
}
