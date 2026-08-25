import { phone } from 'phone'
export function normalizePhoneNumber(value: string): string | null {
  const result = phone(value)
  return result.isValid ? result.phoneNumber : null
}
export function isPhoneNumber(value: string): boolean {
  return normalizePhoneNumber(value) !== null
}
