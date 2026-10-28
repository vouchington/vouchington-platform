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
  it('defaults read() to the read pool', async () => {
    const { api, pools } = createApi()
    await api.read('/* bare */ SELECT 1')
    await api.read('/* options */ SELECT 1', {})
    await api.read('/* values */ SELECT $1', [1])
    await api.read('/* values and options */ SELECT $1', [1], {})
    expect(pools()).toEqual(['read', 'read', 'read', 'read'])
  })

  it('sends read() to the write pool when the caller passes readOnly: false', async () => {
    const { api, pools } = createApi()
    await api.read('/* second */ SELECT 1', { readOnly: false })
    await api.read('/* third */ SELECT $1', [1], { readOnly: false })
    await api.read('/* third wins */ SELECT 1', { readOnly: true }, { readOnly: false })
    await api.read('/* third wins back */ SELECT 1', { readOnly: false }, { readOnly: true })
    expect(pools()).toEqual(['write', 'write', 'write', 'read'])
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
    await api.query('/* override */ SELECT 1', { readOnly: true }, { readOnly: false })
    await api.query('/* default */ SELECT 1')
    expect(pools()).toEqual(['read', 'read', 'write', 'write'])
  })
})
