/* oxlint-disable typescript/unbound-method */
import { access, readFile } from 'node:fs/promises'
import { describe, expect, it, vi } from 'vitest'

import { processMediaMetadata, type ProcessMediaMetadataDependencies } from './metadata.mts'

interface Record {
  id: string
  key: string
  state: string
}
const record = { id: 'id', key: 'key', state: 'processing' }

function dependencies(
  overrides: Partial<ProcessMediaMetadataDependencies<Record, { size: number }>> = {},
): ProcessMediaMetadataDependencies<Record, { size: number }> {
  return {
    load: async () => record,
    canProcess: () => true,
    getObjectKey: (value) => value.key,
    readObject: async () =>
      (async function* () {
        yield Buffer.from('media')
      })(),
    extractMetadata: async (path) => ({ size: (await readFile(path)).length }),
    validateMetadata: async () => undefined,
    finalize: async (value) => ({ ...value, state: 'complete' }),
    markFailed: vi.fn(async () => undefined),
    onFailed: vi.fn(async () => undefined),
    onFinalized: vi.fn(async () => undefined),
    onPostFinalizeError: vi.fn(async () => undefined),
    ...overrides,
  }
}

describe('processMediaMetadata', () => {
  it('extracts from a temporary file, validates, finalizes, and publishes', async () => {
    let path = ''
    const deps = dependencies({
      extractMetadata: async (temporaryPath) => {
        path = temporaryPath
        return { size: (await readFile(temporaryPath)).length }
      },
    })
    await expect(processMediaMetadata('id', deps)).resolves.toMatchObject({ state: 'complete' })
    await expect(access(path)).rejects.toThrow()
    expect(deps.onFinalized).toHaveBeenCalledOnce()
  })

  it('skips missing records and records that cannot be processed', async () => {
    const missing = dependencies({ load: async () => null })
    await expect(processMediaMetadata('id', missing)).resolves.toBeNull()
    expect(missing.markFailed).not.toHaveBeenCalled()
    const deps = dependencies({ canProcess: () => false })
    await expect(processMediaMetadata('id', deps)).resolves.toBeNull()
    expect(deps.markFailed).not.toHaveBeenCalled()
  })

  it('marks extraction failures and treats zero-row finalization as a no-op', async () => {
    const extractFailure = dependencies({
      extractMetadata: async () => Promise.reject(new Error('inspect')),
    })
    await expect(processMediaMetadata('id', extractFailure)).rejects.toThrow('inspect')
    expect(extractFailure.markFailed).toHaveBeenCalledOnce()
    expect(extractFailure.onFailed).toHaveBeenCalledOnce()

    const stale = dependencies({ finalize: async () => null })
    await expect(processMediaMetadata('id', stale)).resolves.toBeNull()
    expect(stale.markFailed).not.toHaveBeenCalled()
  })

  it('preserves processing errors when failure reporting fails', async () => {
    await expect(
      processMediaMetadata(
        'id',
        dependencies({
          validateMetadata: () => {
            throw new Error('invalid')
          },
          markFailed: async () => Promise.reject(new Error('mark')),
        }),
      ),
    ).rejects.toThrow('invalid')
  })

  it('does not undo finalization when publication or reporting fails', async () => {
    await expect(
      processMediaMetadata(
        'id',
        dependencies({
          onFinalized: async () => Promise.reject(new Error('publish')),
          onPostFinalizeError: async () => Promise.reject(new Error('report')),
        }),
      ),
    ).resolves.toMatchObject({ state: 'complete' })
  })
})
