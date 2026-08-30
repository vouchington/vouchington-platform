import type { CreatedMediaUpload, MediaUploadPolicy, PendingMediaUpload } from './types.mts'
import { MediaError } from './errors.mts'
import { validateMediaUpload, type MediaUploadInput } from './validation.mts'

export interface CreateMediaUploadDependencies<Record> {
  createId(): string
  createObjectKey(id: string): string
  expiresInSeconds: number
  now?: () => Date
  policy: MediaUploadPolicy
  presignUpload(input: {
    contentLength: number
    contentType: string
    expiresInSeconds: number
    key: string
  }): Promise<string>
  savePending(upload: PendingMediaUpload): Promise<Record>
}

export async function createMediaUpload<Record>(
  input: MediaUploadInput,
  dependencies: CreateMediaUploadDependencies<Record>,
): Promise<CreatedMediaUpload<Record>> {
  const validated = validateMediaUpload(input, dependencies.policy)
  const id = dependencies.createId()
  const key = dependencies.createObjectKey(id)
  const { expiresInSeconds } = dependencies
  if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new MediaError('EXPIRY_INVALID', 'The upload expiry must be a positive safe integer')
  }
  const now = dependencies.now?.() ?? new Date()
  const pending = { ...validated, id, key }
  const uploadUrl = await dependencies.presignUpload({ ...pending, expiresInSeconds })
  const record = await dependencies.savePending(pending)
  const expiresAt = new Date(now.getTime() + expiresInSeconds * 1_000)
  return { ...pending, expiresAt, record, uploadUrl }
}
