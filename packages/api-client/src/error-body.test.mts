import { describe, expect, it, vi } from 'vitest'
import { parseErrorResponseBody } from './error-body.mts'

function streamOf(...chunks: Uint8Array[]): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk)
      controller.close()
    },
  })
}

const encode = (text: string) => new TextEncoder().encode(text)

describe('parseErrorResponseBody', () => {
  it('parses JSON bodies', async () => {
    expect(await parseErrorResponseBody(new Response('{"code":"X"}'))).toEqual({ code: 'X' })
  })

  it('returns raw text for non-JSON bodies, decoding split multibyte characters', async () => {
    const bytes = encode('héllo')
    const response = new Response(streamOf(bytes.slice(0, 2), bytes.slice(2)))
    expect(await parseErrorResponseBody(response)).toBe('héllo')
  })

  it('returns an empty string for bodyless responses', async () => {
    expect(await parseErrorResponseBody(new Response(null, { status: 500 }))).toBe('')
  })

  it('discards bodies whose content-length exceeds the limit', async () => {
    const response = new Response('{"a":1}', { headers: { 'content-length': '100' } })
    expect(await parseErrorResponseBody(response, { maxBytes: 10 })).toBeNull()
  })

  it('reports a failed cancellation of an oversized declared body', async () => {
    const onError = vi.fn<(error: unknown) => void>()
    const response = new Response('x', { headers: { 'content-length': '100' } })
    const failure = new Error('cancel failed')
    vi.spyOn(response.body!, 'cancel').mockRejectedValue(failure)
    expect(await parseErrorResponseBody(response, { maxBytes: 10, onError })).toBeNull()
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('tolerates a failed cancellation without an onError reporter', async () => {
    const response = new Response('x', { headers: { 'content-length': '100' } })
    vi.spyOn(response.body!, 'cancel').mockRejectedValue(new Error('cancel failed'))
    expect(await parseErrorResponseBody(response, { maxBytes: 10 })).toBeNull()
  })

  it('stops reading once the streamed body exceeds the limit', async () => {
    const response = new Response(streamOf(encode('aaaaaa'), encode('bbbbbb')))
    expect(await parseErrorResponseBody(response, { maxBytes: 8 })).toBeNull()
  })

  it('reports a failed cancellation of an oversized streamed body', async () => {
    const onError = vi.fn<(error: unknown) => void>()
    const failure = new Error('cancel failed')
    const response = new Response(streamOf(encode('aaaaaaaaaa')))
    const reader = response.body!.getReader()
    const getReader = vi.spyOn(response.body!, 'getReader')
    getReader.mockReturnValue(Object.assign(reader, { cancel: () => Promise.reject(failure) }))
    expect(await parseErrorResponseBody(response, { maxBytes: 4, onError })).toBeNull()
    expect(onError).toHaveBeenCalledWith(failure)
  })

  it('returns null when the stream errors', async () => {
    const body = new ReadableStream({
      start(controller) {
        controller.error(new Error('network'))
      },
    })
    expect(await parseErrorResponseBody(new Response(body))).toBeNull()
  })

  it('uses the default limit of 64 KiB', async () => {
    const response = new Response('x', { headers: { 'content-length': String(64 * 1024 + 1) } })
    expect(await parseErrorResponseBody(response)).toBeNull()
  })
})
