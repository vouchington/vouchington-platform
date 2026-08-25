const prescanBytes = 1024
const xmlEncoding = /^\uFEFF?<\?xml\s+[^>]*\bencoding\s*=\s*["']([^"']+)["']/i
const contentTypeCharset = /(?:^|;)\s*charset\s*=\s*("?)([^";\s]+)\1/i
export function decodeFeed(body, contentType) {
  const buffer = Buffer.from(body)
  const labels = [bomCharset(buffer), contentCharset(contentType), xmlCharset(buffer), 'utf-8']
  for (const label of labels) {
    if (!label) continue
    try {
      return new TextDecoder(label, { fatal: true }).decode(buffer)
    } catch {
      // Try the next declared or fallback encoding.
    }
  }
  return new TextDecoder('windows-1252').decode(buffer)
}
function bomCharset(body) {
  if (body.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf]))) return 'utf-8'
  if (body.subarray(0, 2).equals(Buffer.from([0xff, 0xfe]))) return 'utf-16le'
  if (body.subarray(0, 2).equals(Buffer.from([0xfe, 0xff]))) return 'utf-16be'
  return null
}
function contentCharset(contentType) {
  return contentType?.match(contentTypeCharset)?.[2]?.trim() ?? null
}
function xmlCharset(body) {
  const prefix = body.subarray(0, prescanBytes).toString('latin1')
  return prefix.match(xmlEncoding)?.[1]?.trim() ?? null
}
