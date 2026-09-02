import { AuthError } from './errors.mts'

export function encodeStateSegment(value: unknown): string {
  const text = String(value)
  if (!isWellFormedUnicode(text))
    throw new AuthError('invalid_request', 400, 'State identifier is malformed')
  return encodeURIComponent(text)
}

export function encodeSerializedStateSegment(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0)
    throw new AuthError('invalid_request', 400, 'Serialized state identifier is invalid')
  return encodeStateSegment(value)
}

function isWellFormedUnicode(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index)
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1)
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false
      index += 1
    } else if (code >= 0xdc00 && code <= 0xdfff) return false
  }
  return true
}
