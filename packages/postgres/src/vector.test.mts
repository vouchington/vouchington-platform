import pg from 'pg'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { registerPgVectorTypes } from './vector.mts'

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
