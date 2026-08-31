import { access, readFile, readdir, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'

import { MediaSizeLimitError } from './errors.mts'
import { hashMediaBody, spoolMediaBody, withTemporaryMediaFile } from './streams.mts'

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

  it('spools a private file until its owner cleans it up', async () => {
    const spooled = await spoolMediaBody(body('media'), { prefix: 'vouchington-media-test-' })
    expect(await readFile(spooled.path, 'utf8')).toBe('media')
    expect((await stat(spooled.path)).mode & 0o777).toBe(0o600)
    await spooled.cleanup()
    await spooled.cleanup()
    await expect(access(spooled.path)).rejects.toThrow()
  })

  it('enforces a streaming size limit and cleans up failed spools', async () => {
    const prefix = `vouchington-media-limit-${Date.now()}-`
    await expect(spoolMediaBody(body('ab', 'c'), { maxBytes: 2, prefix })).rejects.toMatchObject({
      name: 'MediaSizeLimitError',
      maxBytes: 2,
      size: 3,
    } satisfies Partial<MediaSizeLimitError>)
    expect((await readdir(tmpdir())).filter((entry) => entry.startsWith(prefix))).toEqual([])
    await expect(spoolMediaBody(body('x'), { maxBytes: -1 })).rejects.toThrow('maxBytes')
    await expect(spoolMediaBody(body('x'), { prefix: '../media' })).rejects.toThrow('prefix')
  })

  it('uses owned spools for temporary-file callbacks and always removes them', async () => {
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
