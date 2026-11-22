import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createJsonlPartitionWriter } from './jsonl-partition-writer.mts'

type Rec = { table: string; date: string; n: number }
const partition = (r: Rec) => `${r.table}/${r.date}.jsonl`

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'jsonl-writer-'))
})
afterEach(async () => {
  vi.useRealTimers()
  await rm(dir, { recursive: true, force: true })
})

const read = (name: string) => readFile(join(dir, name), 'utf8')

describe('createJsonlPartitionWriter', () => {
  it('appends records to their partition files on flush', async () => {
    const writer = createJsonlPartitionWriter<Rec>({ directory: dir, partition, onError: vi.fn() })
    writer.write({ table: 'a', date: 'd1', n: 1 })
    writer.write({ table: 'a', date: 'd1', n: 2 })
    writer.write({ table: 'b', date: 'd1', n: 3 })
    await writer.flush()
    writer.write({ table: 'a', date: 'd1', n: 4 })
    await writer.flush()
    await writer.flush()
    expect(await read('a/d1.jsonl')).toBe(
      ['1', '2', '4']
        .map((n) => JSON.stringify({ table: 'a', date: 'd1', n: Number(n) }))
        .join('\n') + '\n',
    )
    expect(await read('b/d1.jsonl')).toBe('{"table":"b","date":"d1","n":3}\n')
  })

  it('flushes on the default one second timer', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
    const writer = createJsonlPartitionWriter<Rec>({ directory: dir, partition, onError: vi.fn() })
    writer.write({ table: 'a', date: 'd', n: 1 })
    writer.write({ table: 'a', date: 'd', n: 2 })
    await vi.advanceTimersByTimeAsync(999)
    await expect(read('a/d.jsonl')).rejects.toThrow()
    await vi.advanceTimersByTimeAsync(1)
    await vi.waitFor(async () => expect((await read('a/d.jsonl')).split('\n')).toHaveLength(3))
  })

  it('flushes at the record limit and the byte limit', async () => {
    const byCount = createJsonlPartitionWriter<Rec>({
      directory: dir,
      partition,
      onError: vi.fn(),
      maxRecords: 2,
    })
    byCount.write({ table: 'c', date: 'd', n: 1 })
    byCount.write({ table: 'c', date: 'd', n: 2 })
    await byCount.flush()
    expect((await read('c/d.jsonl')).trim().split('\n')).toHaveLength(2)

    const byBytes = createJsonlPartitionWriter<Rec>({
      directory: dir,
      partition,
      onError: vi.fn(),
      maxBytes: 10,
    })
    byBytes.write({ table: 'e', date: 'd', n: 1 })
    await byBytes.flush()
    expect(await read('e/d.jsonl')).toContain('"n":1')
  })

  it('rejects partitions that escape the directory', () => {
    const writer = createJsonlPartitionWriter<string>({
      directory: dir,
      partition: (name) => name,
      onError: vi.fn(),
    })
    for (const bad of ['../x.jsonl', '.']) {
      expect(() => writer.write(bad)).toThrow(RangeError)
    }
  })

  it('rejects flush with the first failure after draining the rest', async () => {
    await writeFile(join(dir, 'blocked'), 'file')
    const writer = createJsonlPartitionWriter<Rec>({ directory: dir, partition, onError: vi.fn() })
    writer.write({ table: 'blocked', date: 'd', n: 1 })
    writer.write({ table: 'ok', date: 'd', n: 2 })
    await expect(writer.flush()).rejects.toThrow()
    expect(await read('ok/d.jsonl')).toContain('"n":2')
    await expect(writer.flush()).resolves.toBeUndefined()
  })

  it('reports background flush failures to onError', async () => {
    await writeFile(join(dir, 'blocked'), 'file')
    const onError = vi.fn()
    const writer = createJsonlPartitionWriter<Rec>({
      directory: dir,
      partition,
      onError,
      maxRecords: 1,
    })
    writer.write({ table: 'blocked', date: 'd', n: 1 })
    await vi.waitFor(() => expect(onError).toHaveBeenCalledWith(expect.any(Error)))
  })
})
