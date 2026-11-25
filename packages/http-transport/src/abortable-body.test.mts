import { Response as UndiciResponse } from 'undici'
import { describe, expect, it, vi } from 'vitest'
import { withAbortableBody } from './fetch.mts'

describe('withAbortableBody', () => {
  it('returns native Response unchanged when no signal is supplied', () => {
    const response = new Response('native', { status: 201, headers: { 'x-test': '1' } })
    expect(withAbortableBody(response)).toBe(response)
  })

  it('returns bodyless responses without wrapping a stream', async () => {
    const nativeEmpty = new Response(null, { status: 204, statusText: 'No Content' })
    const controller = new AbortController()
    expect(withAbortableBody(nativeEmpty, controller.signal)).toBe(nativeEmpty)

    const undiciEmpty = new UndiciResponse(null, { status: 204, statusText: 'No Content' })
    const wrappedEmpty = withAbortableBody(undiciEmpty as unknown as Response)
    expect(wrappedEmpty).toBeInstanceOf(Response)
    expect(wrappedEmpty.status).toBe(204)
    expect(wrappedEmpty.statusText).toBe('No Content')
    expect(wrappedEmpty.body).toBeNull()

    const bare = withAbortableBody({ body: null })
    expect(bare.status).toBe(200)
    expect(bare.body).toBeNull()
  })

  it('streams chunks and preserves metadata for wrapped responses', async () => {
    const undiciResponse = new UndiciResponse('hello world', {
      status: 201,
      statusText: 'Created',
      headers: { 'content-type': 'text/plain' },
    })
    const wrapped = withAbortableBody(undiciResponse as unknown as Response)
    expect(wrapped).toBeInstanceOf(Response)
    expect(wrapped.status).toBe(201)
    expect(wrapped.statusText).toBe('Created')
    expect(wrapped.headers.get('content-type')).toBe('text/plain')
    expect(await wrapped.text()).toBe('hello world')
    expect(undiciResponse.body?.locked).toBe(false)
  })

  it('cancels the underlying body when the signal aborts and reports cancel errors', async () => {
    const controller = new AbortController()
    const abortReason = new Error('stop reading')
    const cancelFailure = new Error('cancel boom')
    const onError = vi.fn()
    let seenReason: unknown

    const source = new Response(
      new ReadableStream<Uint8Array>({
        cancel(reason) {
          seenReason = reason
          return Promise.reject(cancelFailure)
        },
      }),
    )

    const wrapped = withAbortableBody(source, controller.signal, { onError })
    const reading = wrapped.text()
    controller.abort(abortReason)

    await expect(reading).resolves.toBe('')
    expect(seenReason).toBe(abortReason)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(cancelFailure))
    expect(source.body?.locked).toBe(false)
  })

  it('cancels immediately when given an already-aborted signal', async () => {
    const reason = new Error('already aborted')
    let seenReason: unknown
    const source = new Response(
      new ReadableStream<Uint8Array>({
        cancel(value) {
          seenReason = value
        },
      }),
    )

    const wrapped = withAbortableBody(source, AbortSignal.abort(reason))
    await expect(wrapped.text()).resolves.toBe('')
    expect(seenReason).toBe(reason)
    expect(source.body?.locked).toBe(false)
  })

  it('propagates stream errors, rejects non-byte chunks, and forwards consumer cancel', async () => {
    const streamError = new Error('broken stream')
    const errored = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          controller.error(streamError)
        },
      }),
    )
    await expect(withAbortableBody(errored, new AbortController().signal).text()).rejects.toBe(
      streamError,
    )
    expect(errored.body?.locked).toBe(false)

    const nonBytes = new ReadableStream<string>({
      start(controller) {
        controller.enqueue('not-bytes')
        controller.close()
      },
    })
    const fakeResponse = { body: nonBytes as unknown as ReadableStream<Uint8Array> }
    await expect(withAbortableBody(fakeResponse).text()).rejects.toThrow(
      'Response body chunk is not bytes',
    )
    expect(nonBytes.locked).toBe(false)

    let consumerCancelReason: unknown
    const cancellable = new Response(
      new ReadableStream<Uint8Array>({
        cancel(reason) {
          consumerCancelReason = reason
          return Promise.reject(new Error('ignored cancel failure'))
        },
      }),
    )
    const wrapped = withAbortableBody(cancellable, new AbortController().signal)
    await wrapped.body?.cancel('done')
    expect(consumerCancelReason).toBe('done')
    expect(cancellable.body?.locked).toBe(false)
  })
})
