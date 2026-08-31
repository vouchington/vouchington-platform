import { createHash } from 'node:crypto'
import { createWriteStream } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'

import { MediaSizeLimitError } from './errors.mts'
import type { MediaBody } from './types.mts'

export interface SpoolMediaBodyOptions {
  maxBytes?: number
  prefix?: string
}

export interface SpooledMediaBody {
  cleanup(): Promise<void>
  path: string
}

export async function hashMediaBody(body: MediaBody, algorithm = 'sha256'): Promise<string> {
  const hash = createHash(algorithm)
  for await (const chunk of body) hash.update(chunk)
  return hash.digest('hex')
}

export async function spoolMediaBody(
  body: MediaBody,
  options: SpoolMediaBodyOptions = {},
): Promise<SpooledMediaBody> {
  validateSpoolOptions(options)
  const directory = await mkdtemp(join(tmpdir(), options.prefix ?? 'vouchington-media-'))
  const path = join(directory, 'media')
  let cleaned = false
  const cleanup = async () => {
    if (cleaned) return
    cleaned = true
    await rm(directory, { force: true, recursive: true })
  }
  try {
    await pipeline(
      enforceMaximumSize(body, options.maxBytes),
      createWriteStream(path, { flags: 'wx', mode: 0o600 }),
    )
    return { path, cleanup }
  } catch (error) {
    await cleanup()
    throw error
  }
}

export async function withTemporaryMediaFile<Result>(
  body: MediaBody,
  useFile: (path: string) => Promise<Result>,
  options?: SpoolMediaBodyOptions,
): Promise<Result> {
  const spooled = await spoolMediaBody(body, options)
  try {
    return await useFile(spooled.path)
  } finally {
    await spooled.cleanup()
  }
}

async function* enforceMaximumSize(
  body: MediaBody,
  maxBytes: number | undefined,
): AsyncIterable<Uint8Array> {
  let size = 0
  for await (const chunk of body) {
    if (maxBytes !== undefined && chunk.byteLength > maxBytes - size) {
      throw new MediaSizeLimitError(maxBytes, size + chunk.byteLength)
    }
    size += chunk.byteLength
    yield chunk
  }
}

function validateSpoolOptions(options: SpoolMediaBodyOptions): void {
  if (
    options.maxBytes !== undefined &&
    (!Number.isSafeInteger(options.maxBytes) || options.maxBytes < 0)
  ) {
    throw new RangeError('maxBytes must be a non-negative safe integer')
  }
  if (options.prefix !== undefined && (!options.prefix || /[\\/]/.test(options.prefix))) {
    throw new RangeError('prefix must be a non-empty filename prefix')
  }
}
