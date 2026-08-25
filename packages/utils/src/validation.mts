const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
export function isEmailAddress(value: string): boolean {
  return Boolean(value) && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
}
export function isUuid(value: string): boolean {
  return UUID.test(value)
}
