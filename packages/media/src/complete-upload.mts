import { MediaError } from './errors.mts'
import { hashMediaBody } from './streams.mts'
import type { MediaBody } from './types.mts'

export type DuplicateMediaDecision = 'reject' | 'replace' | 'reuse'
export type PersistDigestResult<Record> =
  | { kind: 'saved'; record: Record }
  | { kind: 'conflict'; record: Record }

export interface CompleteMediaUploadDependencies<Record> {
  authorize(record: Record): boolean | Promise<boolean>
  canComplete(record: Record): boolean
  claim(id: string): Promise<Record | null>
  deleteMedia(record: Record): Promise<void>
  enqueueMetadata(record: Record): Promise<void>
  findByDigest(digest: string): Promise<Record | null>
  getObjectKey(record: Record): string
  load(id: string): Promise<Record | null>
  markFailed(record: Record, error: unknown): Promise<void>
  onDuplicate(existing: Record, incoming: Record): DuplicateMediaDecision
  persistDigest(id: string, digest: string): Promise<PersistDigestResult<Record>>
  readObject(key: string): Promise<MediaBody>
}

export async function completeMediaUpload<Record>(
  id: string,
  dependencies: CompleteMediaUploadDependencies<Record>,
): Promise<Record> {
  const loaded = await dependencies.load(id)
  if (loaded === null) throw new MediaError('MEDIA_NOT_FOUND', 'The media upload was not found')
  if (!(await dependencies.authorize(loaded))) {
    throw new MediaError('UNAUTHORIZED', 'The media upload is not authorized')
  }
  if (!dependencies.canComplete(loaded)) {
    throw new MediaError('INVALID_STATE', 'The media upload cannot be completed in its state')
  }
  const incoming = await dependencies.claim(id)
  if (incoming === null)
    throw new MediaError('INVALID_STATE', 'The media upload was already claimed')

  try {
    const body = await dependencies.readObject(dependencies.getObjectKey(incoming))
    const digest = await hashMediaBody(body)
    const duplicate = await dependencies.findByDigest(digest)
    if (duplicate !== null) {
      const resolved = await resolveDuplicate(duplicate, incoming, dependencies)
      if (resolved !== null) return resolved
    }

    const result = await dependencies.persistDigest(id, digest)
    if (result.kind === 'conflict') {
      await dependencies.deleteMedia(incoming)
      return result.record
    }
    await dependencies.enqueueMetadata(result.record)
    return result.record
  } catch (error) {
    try {
      await dependencies.markFailed(incoming, error)
    } catch {
      // Preserve the workflow error; failure reporting is best effort.
    }
    throw error
  }
}

async function resolveDuplicate<Record>(
  existing: Record,
  incoming: Record,
  dependencies: CompleteMediaUploadDependencies<Record>,
): Promise<Record | null> {
  const decision = dependencies.onDuplicate(existing, incoming)
  if (decision === 'replace') {
    await dependencies.deleteMedia(existing)
    return null
  }
  await dependencies.deleteMedia(incoming)
  if (decision === 'reuse') return existing
  throw new MediaError('DUPLICATE_MEDIA', 'The media duplicates an existing object')
}
