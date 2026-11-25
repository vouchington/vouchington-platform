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
    const wrappedEmpty = withAbortableBody(undiciEmpty)
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
    const wrapped = withAbortableBody(undiciResponse)
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
    // Let pull() enter reader.read() before aborting so both pull and cancel settle cleanly.
    await Promise.resolve()
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

  it('guards pull and consumer cancel after an abort releases a buffered stream reader', async () => {
    const encoder = new TextEncoder()
    const onError = vi.fn()
    const abortController = new AbortController()
    const bufferedRead = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('first-chunk'))
        },
      }),
    )

    const wrappedRead = withAbortableBody(bufferedRead, abortController.signal, { onError })
    // Let the outer ReadableStream pull the initial chunk into its internal queue, leaving pull idle.
    await Promise.resolve()
    await Promise.resolve()
    abortController.abort(new Error('timeout'))
    await vi.waitFor(() => expect(bufferedRead.body?.locked).toBe(false))

    await expect(wrappedRead.text()).resolves.toBe('first-chunk')
    expect(onError).not.toHaveBeenCalled()

    const cancelController = new AbortController()
    const bufferedCancel = new Response(
      new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode('buffered'))
        },
      }),
    )
    const wrappedCancel = withAbortableBody(bufferedCancel, cancelController.signal, { onError })
    // Let the initial chunk buffer so wrappedCancel remains open when the signal aborts.
    await Promise.resolve()
    await Promise.resolve()
    cancelController.abort(new Error('timeout'))
    await vi.waitFor(() => expect(bufferedCancel.body?.locked).toBe(false))

    await expect(wrappedCancel.body?.cancel('consumer-cancel')).resolves.toBeUndefined()
    expect(onError).not.toHaveBeenCalled()
  })

  it('deduplicates concurrent cancellation and closes pull while cancel is in flight', async () => {
    let resolveCancel!: () => void
    let cancelCalls = 0
    const onError = vi.fn()
    const controller = new AbortController()
    const source = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          cancelCalls += 1
          return new Promise<void>((resolve) => {
            resolveCancel = resolve
          })
        },
      }),
    )

    const wrapped = withAbortableBody(source, controller.signal, { onError })
    // Abort starts cancellation, keeping cancelPromise pending (released is still false).
    controller.abort(new Error('in-flight'))
    const textPromise = wrapped.text()
    resolveCancel()
    await expect(textPromise).resolves.toBe('')
    expect(cancelCalls).toBe(1)
    expect(onError).not.toHaveBeenCalled()

    let resolveSecondCancel!: () => void
    let secondCancelCalls = 0
    const secondController = new AbortController()
    const secondSource = new Response(
      new ReadableStream<Uint8Array>({
        cancel() {
          secondCancelCalls += 1
          return new Promise<void>((resolve) => {
            resolveSecondCancel = resolve
          })
        },
      }),
    )

    const wrappedSecond = withAbortableBody(secondSource, secondController.signal, { onError })
    secondController.abort(new Error('first'))
    const consumerCancel = wrappedSecond.body?.cancel('second')
    resolveSecondCancel()
    await expect(consumerCancel).resolves.toBeUndefined()
    expect(secondCancelCalls).toBe(1)
    expect(onError).not.toHaveBeenCalled()
  })
})
