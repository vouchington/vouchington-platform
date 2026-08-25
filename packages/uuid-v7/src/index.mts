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
export function getDateFromUuidv7(value: string): Date | null {
  return isUuidv7(value)
    ? new Date(Number.parseInt(value.replaceAll('-', '').slice(0, 12), 16))
    : null
}
export function getMinUuidv7ForDate(date: Date): string {
  return makeDateBound(date, 0, 0)
}
export function getMaxUuidv7ForDate(date: Date): string {
  return makeDateBound(date, 0x7fff_ffff, 0xff)
}
export function uuidv7RandomToBase36(value: string): string {
  return BigInt(`0x${validateUuidv7(value).replaceAll('-', '').slice(-18)}`).toString(36)
}
function makeDateBound(date: Date, seq: number, byte: number): string {
  if (!Number.isFinite(date.getTime())) throw new Error('Invalid date')
  return v7({ msecs: date.getTime(), random: new Uint8Array(16).fill(byte), seq })
}
