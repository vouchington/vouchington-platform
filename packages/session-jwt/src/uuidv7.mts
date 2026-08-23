import { v7, validate, version } from 'uuid'

export function mintUuidv7(): string {
  return v7()
}

export function isUuidv7(value: string): boolean {
  return validate(value) && version(value) === 7
}

export function validateUuidv7(value: string): string {
  if (!isUuidv7(value)) throw new Error('Invalid UUIDv7')
  return value
}
