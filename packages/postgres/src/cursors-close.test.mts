import { describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  omitClient: false,
  abortAfterAcquire: false,
  abortController: undefined as AbortController | undefined,
  closeError: new Error('close failed') as unknown,
}))

vi.mock('./cursor-support.mts', async () => {
  const actual =
    await vi.importActual<typeof import('./cursor-support.mts')>('./cursor-support.mts')
  class MockCursor {
    async read(): Promise<unknown[]> {
      return []
    }
    async close(): Promise<void> {
      throw state.closeError
    }
  }
  return {
    ...actual,
    Cursor: MockCursor,
    acquireCursorClient: async () => {
      if (state.omitClient) return { client: undefined, releaseClient: false }
      if (state.abortAfterAcquire) state.abortController?.abort()
      return {
        client: {
          query: (cursor: MockCursor) => cursor,
          release: vi.fn(),
        },
        releaseClient: true,
      }
    },
  }
})

import { createCursorApi } from './cursors.mts'
import type { PsqlRuntime } from './types.mts'

function runtime(): PsqlRuntime {
  return {
    pools: {
      write: { connect: vi.fn() } as never,
      read: { connect: vi.fn() } as never,
      advisoryLock: { connect: vi.fn() } as never,
    },
    env: { NODE_ENV: 'test' },
    errorHandler: () => {},
    onQueryTiming: () => {
      throw new Error('timing boom')
    },
  }
}

describe('cursor close failures', () => {
  it('rethrows an Error from cursor.close()', async () => {
    state.closeError = new Error('close failed')
    state.omitClient = false
    state.abortAfterAcquire = false
    const api = createCursorApi(runtime())
    await expect(
      api.executeHandlerWithCursorInBatches('/* cursor */ SELECT 1', {
        handler: async () => {},
      }),
    ).rejects.toThrow('close failed')
  })

  it('wraps a non-Error from cursor.close()', async () => {
    state.closeError = 'close failed'
    state.omitClient = false
    state.abortAfterAcquire = false
    const api = createCursorApi(runtime())
    await expect(
      (async () => {
        for await (const row of api.createAsyncGeneratorFromCursor('/* cursor */ SELECT 1')) {
          void row
        }
      })(),
    ).rejects.toThrow('cursor close failed')
  })

  it('reads nothing when a client was not acquired', async () => {
    state.omitClient = true
    state.abortAfterAcquire = false
    state.closeError = undefined
    const api = createCursorApi(runtime())
    const rows: unknown[] = []
    for await (const row of api.createAsyncGeneratorFromCursor('/* cursor */ SELECT 1')) {
      rows.push(row)
    }
    expect(rows).toEqual([])
  })

  it('skips cursor setup when abort wins after acquire', async () => {
    state.omitClient = false
    state.abortAfterAcquire = true
    state.abortController = new AbortController()
    state.closeError = undefined
    const api = createCursorApi(runtime())
    const rows: unknown[] = []
    for await (const row of api.createAsyncGeneratorFromCursor('/* cursor */ SELECT 1', {
      abortSignal: state.abortController.signal,
    })) {
      rows.push(row)
    }
    expect(rows).toEqual([])
  })
})
