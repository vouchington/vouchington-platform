const IDENTIFIER = /^[a-z][a-z0-9_]*$/u
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/iu

export function assertSqlIdentifier(value: string, name: string): string {
  if (!IDENTIFIER.test(value) || value.length > 63) throw new Error(`Invalid ${name}: ${value}`)
  return value
}

export function quoteSqlIdentifier(value: string, name: string): string {
  return `"${assertSqlIdentifier(value, name)}"`
}

export function isUuid(value: string): boolean {
  return UUID.test(value)
}

export function assertUuid(value: string, name: string): string {
  if (!isUuid(value)) throw new Error(`Invalid ${name}: ${value}`)
  return value.toLowerCase()
}
