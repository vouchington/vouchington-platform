const MAX_META_TAG_CHARS = 16 * 1024
const OUTPUT_BATCH_CHARS = 16 * 1024

const STALE_AFTER_REWRITE = [
  'content-encoding',
  'content-length',
  'etag',
  'content-md5',
  'digest',
  'content-digest',
]

export type NonceRewriteOptions = {
  /**
   * `<meta name="…">` tags removed from the rewritten HTML, for example trace-context tags that
   * belong to the cache-fill request rather than the client that receives the cached bytes.
   */
  stripMetaNames?: readonly string[]
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
}

/**
 * Streams an HTML response, replacing a cache placeholder nonce with a per-request nonce. Bounded
 * tails keep replacements correct across chunk boundaries without buffering the document.
 * The `content-security-policy` header is the caller's to rebuild with the real nonce.
 */
export function rewritePlaceholderNonce(
  response: Response,
  placeholderNonce: string,
  realNonce: string,
  options: NonceRewriteOptions = {},
): Response {
  if (!response.body || !placeholderNonce || placeholderNonce === realNonce) return response
  const headers = new Headers(response.headers)
  // A byte transform cannot keep the wire length, encoding, or validators of the cached bytes.
  for (const name of STALE_AFTER_REWRITE) headers.delete(name)
  return new Response(
    response.body.pipeThrough(createNonceRewriteStream(placeholderNonce, realNonce, options)),
    { status: response.status, statusText: response.statusText, headers },
  )
}

export function createNonceRewriteStream(
  placeholderNonce: string,
  realNonce: string,
  options: NonceRewriteOptions = {},
): TransformStream<Uint8Array, Uint8Array> {
  const decoder = new TextDecoder()
  const encoder = new TextEncoder()
  const names = options.stripMetaNames ?? []
  const metaTag =
    names.length === 0
      ? undefined
      : new RegExp(`^<meta\\s+name="(?:${names.map(escapeRegExp).join('|')})"[^>]*>$`, 'iu')
  let controller!: TransformStreamDefaultController<Uint8Array>
  let nonceCandidate = ''
  let metaCandidate = ''
  let outputBuffer = ''

  const flushOutput = () => {
    if (!outputBuffer) return
    controller.enqueue(encoder.encode(outputBuffer))
    outputBuffer = ''
  }
  const appendOutput = (output: string) => {
    outputBuffer += output
    if (outputBuffer.length >= OUTPUT_BATCH_CHARS) flushOutput()
  }
  const appendMetaFiltered = (text: string) => {
    for (const char of text) {
      if (!metaTag) {
        appendOutput(char)
      } else if (!metaCandidate) {
        if (char === '<') metaCandidate = char
        else appendOutput(char)
      } else {
        metaCandidate += char
        const lower = metaCandidate.toLowerCase()
        if ('<meta'.startsWith(lower)) continue
        if (!lower.startsWith('<meta') || metaCandidate.length > MAX_META_TAG_CHARS) {
          appendOutput(metaCandidate)
          metaCandidate = ''
        } else if (char === '>') {
          if (!metaTag.test(metaCandidate)) appendOutput(metaCandidate)
          metaCandidate = ''
        }
      }
    }
  }
  const longestPlaceholderPrefix = (value: string): number => {
    const max = Math.min(value.length, placeholderNonce.length - 1)
    for (let length = max; length > 0; length -= 1) {
      if (value.endsWith(placeholderNonce.slice(0, length))) return length
    }
    return 0
  }
  const appendNonceRewritten = (text: string) => {
    for (const char of text) {
      const candidate = nonceCandidate + char
      if (candidate === placeholderNonce) {
        appendMetaFiltered(realNonce)
        nonceCandidate = ''
        continue
      }
      const prefixLength = longestPlaceholderPrefix(candidate)
      appendMetaFiltered(candidate.slice(0, candidate.length - prefixLength))
      nonceCandidate = candidate.slice(candidate.length - prefixLength)
    }
  }

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, ctl) {
      controller = ctl
      appendNonceRewritten(decoder.decode(chunk, { stream: true }))
    },
    flush(ctl) {
      controller = ctl
      appendNonceRewritten(decoder.decode())
      appendMetaFiltered(nonceCandidate)
      appendOutput(metaCandidate)
      flushOutput()
    },
  })
}
