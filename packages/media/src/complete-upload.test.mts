/* oxlint-disable typescript/unbound-method */
import { describe, expect, it, vi } from 'vitest'

import { completeMediaUpload, type CompleteMediaUploadDependencies } from './complete-upload.mts'

interface Record {
  id: string
  key: string
  state: string
}
const incoming = { id: 'new', key: 'new-key', state: 'processing' }
const existing = { id: 'old', key: 'old-key', state: 'complete' }

function dependencies(
  overrides: Partial<CompleteMediaUploadDependencies<Record>> = {},
): CompleteMediaUploadDependencies<Record> {
  return {
    load: async () => ({ ...incoming, state: 'pending' }),
    authorize: () => true,
    canComplete: (record) => record.state === 'pending',
    claim: async () => incoming,
    getObjectKey: (record) => record.key,
    readObject: async () =>
      (async function* () {
        yield Buffer.from('abc')
      })(),
    findByDigest: async () => null,
    onDuplicate: () => 'reuse',
    deleteMedia: vi.fn(async () => undefined),
    persistDigest: async () => ({ kind: 'saved', record: incoming }),
    enqueueMetadata: vi.fn(async () => undefined),
    markFailed: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('completeMediaUpload', () => {
  it('hashes, persists, and enqueues a claimed upload', async () => {
    const persistDigest = vi.fn(async () => ({ kind: 'saved' as const, record: incoming }))
    const deps = dependencies({ persistDigest })
    await expect(completeMediaUpload('new', deps)).resolves.toBe(incoming)
    expect(persistDigest).toHaveBeenCalledWith(
      'new',
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(deps.enqueueMetadata).toHaveBeenCalledWith(incoming)
  })

  it('rejects missing, unauthorized, stale, and already claimed records', async () => {
    await expect(
      completeMediaUpload('x', dependencies({ load: async () => null })),
    ).rejects.toMatchObject({ code: 'MEDIA_NOT_FOUND' })
    await expect(
      completeMediaUpload('x', dependencies({ authorize: async () => false })),
    ).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(
      completeMediaUpload('x', dependencies({ canComplete: () => false })),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' })
    await expect(
      completeMediaUpload('x', dependencies({ claim: async () => null })),
    ).rejects.toMatchObject({ code: 'INVALID_STATE' })
  })

  it.each(['reuse', 'reject', 'replace'] as const)(
    'applies %s duplicate policy',
    async (decision) => {
      const persistDigest = vi.fn(async () => ({ kind: 'saved' as const, record: incoming }))
      const deps = dependencies({
        findByDigest: async () => existing,
        onDuplicate: () => decision,
        persistDigest,
      })
      if (decision === 'reject') {
        await expect(completeMediaUpload('new', deps)).rejects.toMatchObject({
          code: 'DUPLICATE_MEDIA',
        })
        expect(deps.markFailed).toHaveBeenCalledOnce()
      } else {
        await expect(completeMediaUpload('new', deps)).resolves.toBe(
          decision === 'reuse' ? existing : incoming,
        )
      }
      expect(deps.deleteMedia).toHaveBeenCalledWith(decision === 'replace' ? existing : incoming)
      expect(persistDigest).toHaveBeenCalledTimes(decision === 'replace' ? 1 : 0)
    },
  )

  it('returns a conflict winner and cleans up the incoming object', async () => {
    const deps = dependencies({
      persistDigest: async () => ({ kind: 'conflict', record: existing }),
    })
    await expect(completeMediaUpload('new', deps)).resolves.toBe(existing)
    expect(deps.deleteMedia).toHaveBeenCalledWith(incoming)
    expect(deps.enqueueMetadata).not.toHaveBeenCalled()
  })

  it('preserves failures when marking failed also fails', async () => {
    const deps = dependencies({
      readObject: async () => Promise.reject(new Error('read')),
      markFailed: async () => Promise.reject(new Error('mark')),
    })
    await expect(completeMediaUpload('new', deps)).rejects.toThrow('read')
    expect(deps.markFailed).toHaveBeenCalledWith(incoming, expect.any(Error))
  })
})
