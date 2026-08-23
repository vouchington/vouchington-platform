export function decodeCursorBase64(encoded: string): string {
  if (!isValidCursorBase64(encoded)) throw new SyntaxError('Invalid base64 cursor')
  return Buffer.from(encoded, 'base64').toString('utf8')
}

function isValidCursorBase64(encoded: string): boolean {
  const hasUrlAlphabet = /[-_]/.test(encoded)
  const hasStandardAlphabet = /[+/]/.test(encoded)
  if (hasUrlAlphabet && hasStandardAlphabet) return false
  if (hasUrlAlphabet)
    return (
      /^[A-Za-z0-9_-]*$/.test(encoded) &&
      encoded.length % 4 !== 1 &&
      encoded === Buffer.from(encoded, 'base64').toString('base64url')
    )
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) return false
  const padding = encoded.length - encoded.replace(/=+$/, '').length
  const bodyLength = encoded.length - padding
  if (bodyLength % 4 === 1) return false
  const hasValidPadding =
    padding === 0 ||
    (bodyLength % 4 === 2 && padding === 2) ||
    (bodyLength % 4 === 3 && padding === 1)
  if (!hasValidPadding) return false
  const canonical = Buffer.from(encoded, 'base64').toString('base64')
  return encoded === canonical || (padding === 0 && encoded === canonical.replace(/=+$/, ''))
}
