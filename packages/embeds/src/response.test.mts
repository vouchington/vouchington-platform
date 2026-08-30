import { describe, expect, it, vi } from 'vitest'

import { readBoundedBody } from './response.mts'

describe('bounded response bodies', () => {
  it('releases the reader lock after success', async () => {
    const response = new Response('hello')
    await expect(readBoundedBody(response, 5)).resolves.toEqual(
      Uint8Array.from(Buffer.from('hello')),
    )
    expect(response.body?.locked).toBe(false)
  })

  it('cancels and releases the reader after streamed overflow', async () => {
    const cancel = vi.fn()
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(Buffer.from('too large'))
      },
      cancel,
    })
    const response = new Response(stream)
    await expect(readBoundedBody(response, 3)).rejects.toThrow('exceeds 3 bytes')
    expect(cancel).toHaveBeenCalledOnce()
    expect(response.body?.locked).toBe(false)
  })

  it('cancels a body whose declared size exceeds the limit', async () => {
    const cancel = vi.fn()
    const response = new Response(new ReadableStream({ cancel }), {
      headers: { 'content-length': '10' },
    })
    await expect(readBoundedBody(response, 3)).rejects.toThrow('exceeds 3 bytes')
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('handles responses without a body', async () => {
    await expect(readBoundedBody(new Response(null), 1)).resolves.toEqual(new Uint8Array())
  })

  it('preserves the size error when cancellation also fails', async () => {
    const response = new Response(
      new ReadableStream({
        cancel() {
          throw new Error('cancel failed')
        },
      }),
      { headers: { 'content-length': '10' } },
    )
    await expect(readBoundedBody(response, 1)).rejects.toThrow('exceeds 1 byte')
  })

  it('preserves streamed overflow when reader cancellation fails', async () => {
    const response = new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(Buffer.from('large'))
        },
        cancel() {
          throw new Error('cancel failed')
        },
      }),
    )
    await expect(readBoundedBody(response, 1)).rejects.toThrow('exceeds 1 byte')
  })
})
