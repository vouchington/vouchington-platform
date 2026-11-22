import { afterEach, describe, expect, it, vi } from 'vitest'
import { createFirehoseBatcher } from './firehose-batcher.mts'

const text = (data: Uint8Array) => Buffer.from(data).toString()

function setup(options: { flushIntervalMs?: number; retryDelayMs?: number } = {}) {
  const calls: { stream: string; records: string[] }[] = []
  const onError = vi.fn()
  const putRecordBatch = vi.fn(
    async (input: { DeliveryStreamName: string; Records: { Data: Uint8Array }[] }) => {
      calls.push({
        stream: input.DeliveryStreamName,
        records: input.Records.map((r) => text(r.Data)),
      })
      return { FailedPutCount: 0 }
    },
  )
  const batcher = createFirehoseBatcher({ putRecordBatch, onError, retryDelayMs: 0, ...options })
  return { batcher, calls, onError, putRecordBatch }
}

afterEach(() => vi.useRealTimers())

describe('createFirehoseBatcher', () => {
  it('flushes on a one second default timer and groups records per stream', async () => {
    vi.useFakeTimers()
    const { batcher, calls } = setup()
    batcher.write('a', Buffer.from('1'))
    batcher.writeJson('b', { x: 1 })
    batcher.writeJson('a', 2, '|')
    await vi.advanceTimersByTimeAsync(999)
    expect(calls).toEqual([])
    await vi.advanceTimersByTimeAsync(1)
    expect(calls).toEqual([
      { stream: 'a', records: ['1', '2|'] },
      { stream: 'b', records: ['{"x":1}\n'] },
    ])
  })

  it('honors flushIntervalMs and defaults the retry delay to 100ms', async () => {
    vi.useFakeTimers()
    const putRecordBatch = vi
      .fn()
      .mockResolvedValueOnce({ FailedPutCount: 1, RequestResponses: [{ ErrorCode: 'x' }] })
      .mockResolvedValue({ FailedPutCount: 0 })
    const batcher = createFirehoseBatcher({ putRecordBatch, onError: vi.fn(), flushIntervalMs: 50 })
    batcher.write('a', Buffer.from('1'))
    await vi.advanceTimersByTimeAsync(50)
    expect(putRecordBatch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(99)
    expect(putRecordBatch).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(putRecordBatch).toHaveBeenCalledTimes(2)
  })

  it('flushes immediately at the record count', async () => {
    const { batcher, calls } = setup()
    for (let i = 0; i < 500; i++) batcher.write('a', Buffer.from('x'))
    await batcher.flush()
    expect(calls.map((c) => c.records.length)).toEqual([500])
  })

  it('flushes immediately at the byte threshold and splits batches by size', async () => {
    const { batcher, calls } = setup()
    const big = Buffer.alloc(900 * 1024)
    for (let i = 0; i < 5; i++) batcher.write('a', big)
    await batcher.flush()
    expect(calls.map((c) => c.records.length)).toEqual([4, 1])
  })

  it('drops oversize records', async () => {
    const { batcher, calls, onError } = setup()
    batcher.write('a', Buffer.alloc(1_000 * 1024 + 1))
    await batcher.flush()
    expect(calls).toEqual([])
    expect(onError).toHaveBeenCalledWith(expect.any(RangeError))
  })

  it('sends records written during a flush and resolves empty flushes', async () => {
    const { batcher, calls } = setup()
    await batcher.flush()
    batcher.write('a', Buffer.from('1'))
    const first = batcher.flush()
    batcher.write('a', Buffer.from('2'))
    await Promise.all([first, batcher.flush()])
    expect(calls.flatMap((c) => c.records)).toEqual(['1', '2'])
  })

  it('retries rejected records once after the delay, then drops them', async () => {
    vi.useFakeTimers()
    const onError = vi.fn()
    const putRecordBatch = vi
      .fn()
      .mockResolvedValueOnce({ FailedPutCount: 1, RequestResponses: [{}, { ErrorCode: 'x' }] })
      .mockResolvedValue({ FailedPutCount: 1, RequestResponses: [{ ErrorCode: 'x' }] })
    const batcher = createFirehoseBatcher({ putRecordBatch, onError, retryDelayMs: 25 })
    batcher.write('s', Buffer.from('ok'))
    batcher.write('s', Buffer.from('bad'))
    const done = batcher.flush()
    await vi.advanceTimersByTimeAsync(25)
    await done
    expect(putRecordBatch).toHaveBeenCalledTimes(2)
    expect(putRecordBatch.mock.calls[1]?.[0].Records).toHaveLength(1)
    expect(onError).toHaveBeenCalledWith(new Error('Dropped 1 Firehose records for stream s'))
  })

  it('retries after a thrown send and wraps non-Error throws', async () => {
    const onError = vi.fn()
    const putRecordBatch = vi.fn().mockRejectedValueOnce('nope').mockResolvedValue({})
    const batcher = createFirehoseBatcher({ putRecordBatch, onError, retryDelayMs: 0 })
    batcher.write('s', Buffer.from('1'))
    await batcher.flush()
    expect(putRecordBatch).toHaveBeenCalledTimes(2)
    expect(onError).toHaveBeenCalledExactlyOnceWith(new Error('nope'))
  })

  it('passes Error throws through unchanged', async () => {
    const error = new Error('real')
    const onError = vi.fn()
    const putRecordBatch = vi.fn().mockRejectedValueOnce(error).mockResolvedValue({})
    const batcher = createFirehoseBatcher({ putRecordBatch, onError, retryDelayMs: 0 })
    batcher.write('s', Buffer.from('1'))
    await batcher.flush()
    expect(onError).toHaveBeenCalledWith(error)
  })

  it('reports a failing background flush to onError', async () => {
    vi.useFakeTimers()
    const onError = vi
      .fn()
      .mockImplementationOnce(() => {
        throw 'handler failed'
      })
      .mockImplementation(() => {})
    const putRecordBatch = vi.fn().mockRejectedValue(new Error('boom'))
    const batcher = createFirehoseBatcher({ putRecordBatch, onError, retryDelayMs: 0 })
    batcher.write('s', Buffer.from('1'))
    await vi.advanceTimersByTimeAsync(1000)
    expect(onError).toHaveBeenCalledWith(new Error('handler failed'))
  })

  it('reports a failing count-triggered flush to onError', async () => {
    const onError = vi.fn().mockImplementationOnce(() => {
      throw new Error('handler failed')
    })
    const batcher = createFirehoseBatcher({
      putRecordBatch: vi.fn().mockRejectedValue(new Error('boom')),
      onError,
      retryDelayMs: 0,
    })
    for (let i = 0; i < 500; i++) batcher.write('s', Buffer.from('x'))
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(new Error('handler failed')))
  })

  it('lets a running flush take records written past the threshold', async () => {
    const { batcher, calls, onError } = setup()
    for (let i = 0; i < 1000; i++) batcher.write('a', Buffer.from('x'))
    await batcher.flush()
    expect(calls.flatMap((c) => c.records)).toHaveLength(1000)
    expect(onError).not.toHaveBeenCalled()
  })
})
