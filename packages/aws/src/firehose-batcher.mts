import type { PutRecordBatchOutput } from '@aws-sdk/client-firehose'
import {
  chunkFirehoseRecords,
  encodeJsonRecord,
  FIREHOSE_MAX_RECORD_BYTES,
  getFailedFirehoseRecords,
} from './firehose-records.mts'

const FIREHOSE_FLUSH_RECORDS = 500
const FIREHOSE_FLUSH_BYTES = 4 * 1024 * 1024

export interface FirehoseBatcherOptions {
  /** Sends one PutRecordBatch request; the caller owns the client, credentials, and region. */
  putRecordBatch: (input: {
    DeliveryStreamName: string
    Records: { Data: Uint8Array }[]
  }) => Promise<Partial<Pick<PutRecordBatchOutput, 'FailedPutCount' | 'RequestResponses'>>>
  /** Receives oversize drops, send failures, records dropped after the retry, and timer flush errors. */
  onError: (error: Error) => void
  /** Delay before buffered records are flushed. Defaults to 1000. */
  flushIntervalMs?: number
  /** Delay before the single retry of records Firehose rejected. Defaults to 100. */
  retryDelayMs?: number
}

export interface FirehoseBatcher {
  /** Buffers one record. Oversize records are reported to onError and dropped. */
  write: (streamName: string, data: Uint8Array) => void
  /** Serializes a value as a delimiter-terminated JSON record and buffers it. */
  writeJson: (streamName: string, value: unknown, delimiter?: string) => void
  /** Sends everything buffered, including records written while the flush runs. */
  flush: () => Promise<void>
}

interface BufferedRecord {
  streamName: string
  data: Uint8Array
}

const toError = (value: unknown): Error =>
  value instanceof Error ? value : new Error(String(value))

const pause = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve()

// Buffers records per delivery stream and flushes on count, size, or time. Records Firehose
// rejects are retried once; send errors never reject flush(), they go to onError.
export function createFirehoseBatcher(options: FirehoseBatcherOptions): FirehoseBatcher {
  const { putRecordBatch, onError } = options
  const flushIntervalMs = options.flushIntervalMs ?? 1000
  const retryDelayMs = options.retryDelayMs ?? 100
  let buffer: BufferedRecord[] = []
  let bufferedBytes = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let active: Promise<void> | undefined

  function clearTimer(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  async function sendOnce(streamName: string, records: Uint8Array[]): Promise<Uint8Array[]> {
    try {
      const output = await putRecordBatch({
        DeliveryStreamName: streamName,
        Records: records.map((Data) => ({ Data })),
      })
      return getFailedFirehoseRecords(records, output)
    } catch (error) {
      onError(toError(error))
      return records
    }
  }

  async function sendWithRetry(streamName: string, records: Uint8Array[]): Promise<void> {
    const failed = await sendOnce(streamName, records)
    if (failed.length === 0) return
    await pause(retryDelayMs)
    const dropped = await sendOnce(streamName, failed)
    if (dropped.length > 0) {
      onError(new Error(`Dropped ${dropped.length} Firehose records for stream ${streamName}`))
    }
  }

  async function drain(): Promise<void> {
    const records = buffer
    buffer = []
    bufferedBytes = 0
    try {
      const groups = Map.groupBy(records, (record) => record.streamName)
      await Promise.all(
        [...groups].flatMap(([streamName, group]) =>
          chunkFirehoseRecords(group.map((record) => record.data)).map((batch) =>
            sendWithRetry(streamName, batch),
          ),
        ),
      )
    } finally {
      active = undefined
    }
  }

  function flush(): Promise<void> {
    clearTimer()
    if (active) return active.then(flush)
    if (buffer.length === 0) return Promise.resolve()
    active = drain()
    return active.then(flush)
  }

  function flushInBackground(): void {
    flush().catch((error: unknown) => onError(toError(error)))
  }

  function write(streamName: string, data: Uint8Array): void {
    if (data.byteLength > FIREHOSE_MAX_RECORD_BYTES) {
      onError(
        new RangeError(
          `Firehose record of ${data.byteLength} bytes exceeds the limit for stream ${streamName}`,
        ),
      )
      return
    }
    buffer.push({ streamName, data })
    bufferedBytes += data.byteLength
    if (buffer.length >= FIREHOSE_FLUSH_RECORDS || bufferedBytes >= FIREHOSE_FLUSH_BYTES) {
      flushInBackground()
      return
    }
    if (timer !== undefined) return
    timer = setTimeout(() => {
      timer = undefined
      flushInBackground()
    }, flushIntervalMs)
    timer.unref()
  }

  return {
    write,
    writeJson: (streamName, value, delimiter) =>
      write(streamName, encodeJsonRecord(value, delimiter)),
    flush,
  }
}
