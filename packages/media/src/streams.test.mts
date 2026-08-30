import { access, readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

import { hashMediaBody, withTemporaryMediaFile } from './streams.mts'

async function* body(...values: string[]) {
  for (const value of values) yield Buffer.from(value)
}

describe('media streams', () => {
  it('hashes streamed bytes', async () => {
    await expect(hashMediaBody(body('a', 'bc'))).resolves.toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    await expect(hashMediaBody(body('abc'), 'sha1')).resolves.toBe(
      'a9993e364706816aba3e25717850c26c9cd0d89d',
    )
  })

  it('writes a private temporary file and always removes it', async () => {
    let path = ''
    await expect(
      withTemporaryMediaFile(body('media'), async (temporaryPath) => {
        path = temporaryPath
        return readFile(temporaryPath, 'utf8')
      }),
    ).resolves.toBe('media')
    await expect(access(path)).rejects.toThrow()

    await expect(
      withTemporaryMediaFile(body('media'), async () => Promise.reject(new Error('inspect'))),
    ).rejects.toThrow('inspect')
  })
})
