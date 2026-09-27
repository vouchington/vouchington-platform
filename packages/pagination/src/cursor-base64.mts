export function decodeCursorBase64(encoded: string): string {
  if (!isValidCursorBase64(encoded)) throw new SyntaxError('Invalid base64 cursor')
  return Buffer.from(encoded, 'base64url').toString('utf8')
}

function isValidCursorBase64(encoded: string): boolean {
  return (
    /^[A-Za-z0-9_-]+$/.test(encoded) &&
    encoded.length % 4 !== 1 &&
    encoded === Buffer.from(encoded, 'base64url').toString('base64url')
  )
}
