import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

import type { MediaBody } from './types.mts'

export async function hashMediaBody(body: MediaBody, algorithm = 'sha256'): Promise<string> {
  const hash = createHash(algorithm)
  for await (const chunk of body) hash.update(chunk)
  return hash.digest('hex')
}

export async function withTemporaryMediaFile<Result>(
  body: MediaBody,
  useFile: (path: string) => Promise<Result>,
): Promise<Result> {
  const directory = await mkdtemp(join(tmpdir(), 'vouchington-media-'))
  const path = join(directory, 'media')
  try {
    await pipeline(body, createWriteStream(path, { flags: 'wx' }))
    return await useFile(path)
  } finally {
    await rm(directory, { force: true, recursive: true })
  }
}
