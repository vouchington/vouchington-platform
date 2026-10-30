import pg from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { deferUntilVectorTypes, registerPgVectorTypes } from './vector.mts'

describe('registerPgVectorTypes', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('registers vector, halfvec, and sparsevec parsers', async () => {
    const query = vi.fn(async () => ({
      rows: [{ vector_oid: 16_384, halfvec_oid: 16_385, sparsevec_oid: 16_386 }],
    }))
    const end = vi.fn(async () => undefined)
    const setTypeParser = vi.spyOn(pg.types, 'setTypeParser').mockImplementation(() => {})
    vi.spyOn(pg, 'Client').mockImplementation(
      class {
        connect = async () => undefined
        query = query
        end = end
      } as never,
    )

    await registerPgVectorTypes('postgres://example/db')
    expect(setTypeParser).toHaveBeenCalledTimes(3)
    expect(end).toHaveBeenCalled()
  })

  it('registers only vector when sibling types are missing', async () => {
    const setTypeParser = vi.spyOn(pg.types, 'setTypeParser').mockImplementation(() => {})
    vi.spyOn(pg, 'Client').mockImplementation(
      class {
        connect = async () => undefined
        query = async () => ({
          rows: [{ vector_oid: 16_384, halfvec_oid: null, sparsevec_oid: null }],
        })
        end = async () => undefined
      } as never,
    )

    await registerPgVectorTypes('postgres://example/db')
    expect(setTypeParser).toHaveBeenCalledTimes(1)
  })

  it('ends the client when the vector type is missing', async () => {
    const end = vi.fn(async () => undefined)
    vi.spyOn(pg, 'Client').mockImplementation(
      class {
        connect = async () => undefined
        query = async () => ({ rows: [{}] })
        end = end
      } as never,
    )

    await expect(registerPgVectorTypes('postgres://example/db')).rejects.toThrow(
      'vector type not found in the database',
    )
    expect(end).toHaveBeenCalled()
  })
})

describe('deferUntilVectorTypes', () => {
  function fakePool(client: string) {
    const connect = vi.fn((callback?: (error: Error | undefined, client: string) => void) =>
      callback ? callback(undefined, client) : Promise.resolve(client),
    )
    return { pool: { connect } as unknown as pg.Pool, connect }
  }

  it('registers once on the first connect, holds every pool, then restores connect', async () => {
    let finish!: () => void
    const register = vi.fn(() => new Promise<void>((resolve) => (finish = resolve)))
    const write = fakePool('w')
    const read = fakePool('r')
    deferUntilVectorTypes([write.pool, read.pool], register)
    expect(register).not.toHaveBeenCalled()

    const viaPromise = write.pool.connect()
    const viaCallback = new Promise((resolve) => {
      read.pool.connect((_error, client) => resolve(client))
    })
    await Promise.resolve()
    expect(register).toHaveBeenCalledOnce()
    expect(write.connect).not.toHaveBeenCalled()
    expect(read.connect).not.toHaveBeenCalled()

    finish()
    await expect(viaPromise).resolves.toBe('w')
    await expect(viaCallback).resolves.toBe('r')
    await expect(write.pool.connect()).resolves.toBe('w')
    expect(register).toHaveBeenCalledOnce()
  })

  it('fails waiting connects with a rejected registration, then connects normally', async () => {
    const failure = new Error('handler threw')
    const write = fakePool('w')
    deferUntilVectorTypes([write.pool], () => Promise.reject(failure))

    const viaCallback = new Promise((resolve) => {
      write.pool.connect((error) => resolve(error))
    })
    await expect(write.pool.connect()).rejects.toBe(failure)
    await expect(viaCallback).resolves.toBe(failure)
    await expect(write.pool.connect()).resolves.toBe('w')
  })
})
