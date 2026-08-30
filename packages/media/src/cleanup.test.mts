import { describe, expect, it, vi } from 'vitest'

import { cleanupAbandonedMedia } from './cleanup.mts'

describe('cleanupAbandonedMedia', () => {
  it('returns without storage or database work when selection is empty', async () => {
    const deleteObjects = vi.fn()
    await expect(
      cleanupAbandonedMedia({
        findAbandoned: async () => [],
        deleteObjects,
        deleteRecords: vi.fn(),
      }),
    ).resolves.toEqual({ deletedRecords: 0, storageDeleted: true })
    expect(deleteObjects).not.toHaveBeenCalled()
  })

  it('deletes records even when storage and reporting fail', async () => {
    const records = [{ id: 1 }]
    const deleteRecords = vi.fn(async () => undefined)
    await expect(
      cleanupAbandonedMedia({
        findAbandoned: async () => records,
        deleteObjects: async () => Promise.reject(new Error('storage')),
        onStorageError: async () => Promise.reject(new Error('report')),
        deleteRecords,
      }),
    ).resolves.toEqual({ deletedRecords: 1, storageDeleted: false })
    expect(deleteRecords).toHaveBeenCalledWith(records)
  })

  it('reports and preserves a database failure', async () => {
    const onDatabaseError = vi.fn(async () => undefined)
    await expect(
      cleanupAbandonedMedia({
        findAbandoned: async () => [1],
        deleteObjects: async () => undefined,
        deleteRecords: async () => Promise.reject(new Error('database')),
        onDatabaseError,
      }),
    ).rejects.toThrow('database')
    expect(onDatabaseError).toHaveBeenCalledOnce()

    await expect(
      cleanupAbandonedMedia({
        findAbandoned: async () => [1],
        deleteObjects: async () => undefined,
        deleteRecords: async () => Promise.reject(new Error('database')),
        onDatabaseError: async () => Promise.reject(new Error('report')),
      }),
    ).rejects.toThrow('database')
  })
})
