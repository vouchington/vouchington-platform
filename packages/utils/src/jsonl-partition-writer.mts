import { appendFile, mkdir } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'

export interface JsonlPartitionWriterOptions<T> {
  /** Root directory; every partition file lives beneath it. */
  directory: string
  /** Relative file path for a record, for example `events/2025-01-31.jsonl`. Must stay inside `directory`. */
  partition: (record: T) => string
  /** Receives background flush failures. Explicit `flush()` calls reject instead. */
  onError: (error: unknown) => void
  /** Flush after this many buffered records. Defaults to 500. */
  maxRecords?: number
  /** Flush after this many buffered bytes. Defaults to 4 MiB. */
  maxBytes?: number
  /** Delay before buffered records are flushed. Defaults to 1000. */
  flushIntervalMs?: number
}

export interface JsonlPartitionWriter<T> {
  write: (record: T) => void
  /** Appends everything buffered, including records written meanwhile; rejects with the first failure. */
  flush: () => Promise<void>
}

interface Buffered {
  file: string
  line: string
}

// Buffers records and appends them to per-partition JSON Lines files on count, size, or time.
export function createJsonlPartitionWriter<T>(
  options: JsonlPartitionWriterOptions<T>,
): JsonlPartitionWriter<T> {
  const { directory, partition, onError } = options
  const maxRecords = options.maxRecords ?? 500
  const maxBytes = options.maxBytes ?? 4 * 1024 * 1024
  const flushIntervalMs = options.flushIntervalMs ?? 1000
  let buffer: Buffered[] = []
  let bufferedBytes = 0
  let timer: ReturnType<typeof setTimeout> | undefined
  let active: Promise<void> | undefined

  function clearTimer(): void {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
  }

  function resolvePath(name: string): string {
    const path = join(directory, name)
    const rel = relative(directory, path)
    if (rel === '' || rel.startsWith('..')) {
      throw new RangeError(`Partition path escapes the directory: ${name}`)
    }
    return path
  }

  async function appendBatch(): Promise<void> {
    const records = buffer
    buffer = []
    bufferedBytes = 0
    const groups = Map.groupBy(records, (record) => record.file)
    const results = await Promise.allSettled(
      [...groups].map(async ([file, items]) => {
        await mkdir(dirname(file), { recursive: true })
        await appendFile(file, `${items.map((item) => item.line).join('\n')}\n`, 'utf8')
      }),
    )
    const failure = results.find((result) => result.status === 'rejected')
    if (failure) throw failure.reason
  }

  async function drain(): Promise<void> {
    let failure: { reason: unknown } | undefined
    while (buffer.length > 0) {
      try {
        await appendBatch()
      } catch (error) {
        failure ??= { reason: error }
      }
    }
    active = undefined
    if (failure) throw failure.reason
  }

  function flush(): Promise<void> {
    clearTimer()
    if (active) return active
    if (buffer.length === 0) return Promise.resolve()
    active = drain()
    return active
  }

  function flushInBackground(): void {
    flush().catch(onError)
  }

  function write(record: T): void {
    const line = JSON.stringify(record)
    buffer.push({ file: resolvePath(partition(record)), line })
    bufferedBytes += Buffer.byteLength(line) + 1
    if (buffer.length >= maxRecords || bufferedBytes >= maxBytes) {
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

  return { write, flush }
}
