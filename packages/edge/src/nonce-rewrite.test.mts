import { describe, expect, it } from 'vitest'
import { rewritePlaceholderNonce } from './nonce-rewrite.mts'

const PLACEHOLDER = 'PLACEHOLDER-NONCE-0123456789abcdef'
const REAL = 'real-nonce'
const encoder = new TextEncoder()

function streamOf(chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

function htmlResponse(
  chunks: string[] | Uint8Array[],
  headers: Record<string, string> = {},
): Response {
  const bytes = chunks.map((chunk) => (typeof chunk === 'string' ? encoder.encode(chunk) : chunk))
  return new Response(streamOf(bytes), { status: 200, statusText: 'OK', headers })
}

async function rewrite(
  chunks: string[],
  options?: Parameters<typeof rewritePlaceholderNonce>[3],
): Promise<string> {
  return rewritePlaceholderNonce(htmlResponse(chunks), PLACEHOLDER, REAL, options).text()
}

describe('rewritePlaceholderNonce', () => {
  it('returns the response unchanged without work to do', () => {
    const noBody = new Response(null, { status: 204 })
    expect(rewritePlaceholderNonce(noBody, PLACEHOLDER, REAL)).toBe(noBody)
    const page = htmlResponse(['x'])
    expect(rewritePlaceholderNonce(page, '', REAL)).toBe(page)
    expect(rewritePlaceholderNonce(page, REAL, REAL)).toBe(page)
  })

  it('drops encoding and length headers and keeps the rest', () => {
    const response = htmlResponse(['x'], {
      'content-encoding': 'gzip',
      'content-length': '1',
      'content-type': 'text/html',
    })
    const result = rewritePlaceholderNonce(response, PLACEHOLDER, REAL)
    expect(result.headers.get('content-encoding')).toBeNull()
    expect(result.headers.get('content-length')).toBeNull()
    expect(result.headers.get('content-type')).toBe('text/html')
    expect(result.status).toBe(200)
    expect(result.statusText).toBe('OK')
  })

  it('replaces every placeholder occurrence', async () => {
    const html = `<script nonce="${PLACEHOLDER}"></script><style nonce="${PLACEHOLDER}"></style>`
    expect(await rewrite([html])).toBe(html.replaceAll(PLACEHOLDER, REAL))
  })

  it('replaces a placeholder split across chunks and keeps near misses', async () => {
    const half = PLACEHOLDER.length / 2
    const chunks = [`<a nonce="${PLACEHOLDER.slice(0, half)}`, `${PLACEHOLDER.slice(half)}">PLACE`]
    expect(await rewrite(chunks)).toBe(`<a nonce="${REAL}">PLACE`)
  })

  it('flushes a trailing partial placeholder verbatim', async () => {
    expect(await rewrite([`end ${PLACEHOLDER.slice(0, 5)}`])).toBe(`end ${PLACEHOLDER.slice(0, 5)}`)
  })

  it('decodes multi-byte characters split across chunks', async () => {
    const bytes = encoder.encode('héllo €')
    const response = htmlResponse([bytes.slice(0, 2), bytes.slice(2)])
    expect(await rewritePlaceholderNonce(response, PLACEHOLDER, REAL).text()).toBe('héllo €')
  })

  it('handles an empty stream', async () => {
    expect(await rewrite([])).toBe('')
  })

  it('batches large output', async () => {
    const big = 'x'.repeat(40_000)
    expect(await rewrite([big, big])).toBe(big + big)
  })

  describe('stripMetaNames', () => {
    const options = { stripMetaNames: ['sentry-trace', 'baggage', 'a.b'] }

    it('removes listed meta tags including split ones', async () => {
      const html =
        '<head><meta name="sentry-trace" content="1"><META NAME="baggage" content="2"><meta name="a.b" content="3"><title>t</title></head>'
      expect(await rewrite([html], options)).toBe('<head><title>t</title></head>')
      expect(await rewrite(['<meta name="sentry-', 'trace" content="1">ok'], options)).toBe('ok')
    })

    it('keeps other meta tags and other tags that start with <m', async () => {
      const html = '<meta name="viewport" content="x"><meta name="axb" content="y"><main></main>'
      expect(await rewrite([html], options)).toBe(html)
    })

    it('does not treat the regex dot as a wildcard', async () => {
      const html = '<meta name="aXb" content="y">'
      expect(await rewrite([html], options)).toBe(html)
    })

    it('passes through an unterminated meta tag longer than the bound', async () => {
      const html = `<meta name="baggage" content="${'x'.repeat(20_000)}`
      expect(await rewrite([html], options)).toBe(html)
    })

    it('flushes an incomplete meta tag at end of stream', async () => {
      expect(await rewrite(['tail <meta name="bagg'], options)).toBe('tail <meta name="bagg')
    })

    it('rewrites the nonce inside text that follows a stripped tag', async () => {
      const html = `<meta name="baggage" content="1"><script nonce="${PLACEHOLDER}">`
      expect(await rewrite([html], options)).toBe(`<script nonce="${REAL}">`)
    })
  })
})
