import { describe, expect, it, vi } from 'vitest'

import { createQueryApi } from './clients.mts'
import type { PsqlRuntime, QueryTimingInput } from './types.mts'

function createApi() {
  const fakePool = () => ({ query: vi.fn(async () => ({ rows: [], rowCount: 0 })) })
  const timings: QueryTimingInput[] = []
  const runtime = {
    pools: { read: fakePool(), write: fakePool() },
    env: {},
    errorHandler: () => {},
    onQueryTiming: (timing: QueryTimingInput) => timings.push(timing),
  } as unknown as PsqlRuntime
  return { api: createQueryApi(runtime), pools: () => timings.map((timing) => timing.pool) }
}

describe('pool selection', () => {
  it('keeps read() on the read pool when the second argument is an options object', async () => {
    const { api, pools } = createApi()
    await api.read('/* options */ SELECT 1', {})
    await api.read('/* explicit write */ SELECT 1', { readOnly: false })
    await api.read('/* values */ SELECT $1', [1])
    expect(pools()).toEqual(['read', 'read', 'read'])
  })

  it('keeps write() on the write pool when the second argument is an options object', async () => {
    const { api, pools } = createApi()
    await api.write('/* options */ SELECT 1', { readOnly: true })
    await api.write('/* values */ SELECT $1', [1])
    expect(pools()).toEqual(['write', 'write'])
  })

  it('lets query() choose the pool from an options object in either position', async () => {
    const { api, pools } = createApi()
    await api.query('/* second */ SELECT 1', { readOnly: true })
    await api.query('/* third */ SELECT $1', [1], { readOnly: true })
    await api.query('/* default */ SELECT 1')
    expect(pools()).toEqual(['read', 'read', 'write'])
  })
})
