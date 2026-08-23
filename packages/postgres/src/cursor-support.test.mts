import { Pool } from 'pg'
import { describe, expect, it, vi } from 'vitest'

import {
  acquireCursorClient,
  getCursorPoolLabel,
  normalizeCursorValues,
  resolveCursorOptions,
} from './cursor-support.mts'
import type { PsqlRuntime } from './types.mts'

function runtime(): PsqlRuntime {
  return {
    pools: {
      write: { connect: vi.fn(async () => ({ kind: 'write' })) } as never,
      read: { connect: vi.fn(async () => ({ kind: 'read' })) } as never,
      advisoryLock: { connect: vi.fn() } as never,
    },
    env: { NODE_ENV: 'test' },
    errorHandler: () => {},
  }
}

describe('cursor support helpers', () => {
  it('copies values and merges option objects', () => {
    expect(normalizeCursorValues()).toBeUndefined()
    expect(normalizeCursorValues([1, 2])).toEqual([1, 2])
    expect(resolveCursorOptions([1], { batchSize: 2 })).toEqual({
      finalOptions: { batchSize: 2 },
      values: [1],
    })
    expect(resolveCursorOptions({ batchSize: 9, readOnly: false }, { batchSize: 2 })).toEqual({
      finalOptions: { batchSize: 9, readOnly: false },
    })
  })

  it('labels and acquires clients from the selected pool', async () => {
    const context = runtime()
    expect(getCursorPoolLabel({})).toBe('read')
    expect(getCursorPoolLabel({ readOnly: false })).toBe('write')
    expect(getCursorPoolLabel({ client: {} as never })).toBe('client')
    await expect(acquireCursorClient(context, {})).resolves.toEqual({
      client: { kind: 'read' },
      releaseClient: true,
    })
    await expect(acquireCursorClient(context, { readOnly: false })).resolves.toEqual({
      client: { kind: 'write' },
      releaseClient: true,
    })
    const existing = { release() {} }
    await expect(acquireCursorClient(context, { client: existing as never })).resolves.toEqual({
      client: existing,
      releaseClient: false,
    })
  })

  it('connects when the provided client is a pool', async () => {
    const pool = new Pool({ connectionString: 'postgres://127.0.0.1:1/none', max: 0 })
    const connected = { from: 'pool' }
    vi.spyOn(pool, 'connect').mockResolvedValue(connected as never)
    await expect(acquireCursorClient(runtime(), { client: pool })).resolves.toEqual({
      client: connected,
      releaseClient: true,
    })
    await pool.end()
  })
})
