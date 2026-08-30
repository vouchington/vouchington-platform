import { MediaError } from './errors.mts'
import type { MediaUploadPolicy, ValidatedMediaUpload } from './types.mts'

export interface MediaUploadInput {
  contentLength: number | null | undefined
  contentType: string | null | undefined
}

export function validateMediaUpload(
  input: MediaUploadInput,
  policy: MediaUploadPolicy,
): ValidatedMediaUpload {
  const contentType = input.contentType?.split(';', 1)[0]?.trim().toLowerCase()
  if (
    contentType === undefined ||
    !/^[a-z0-9!#$%&'*+.^_`|~-]+\/[a-z0-9!#$%&'*+.^_`|~-]+$/.test(contentType) ||
    !policy.acceptsContentType(contentType)
  ) {
    throw new MediaError('CONTENT_TYPE_INVALID', 'The media content type is not accepted')
  }

  const contentLength = input.contentLength
  const minimum = policy.minBytes ?? 1
  if (
    !Number.isSafeInteger(minimum) ||
    minimum < 0 ||
    !Number.isSafeInteger(policy.maxBytes) ||
    policy.maxBytes < minimum
  ) {
    throw new MediaError('POLICY_INVALID', 'Media size policy bounds must be safe integers')
  }
  if (
    contentLength === null ||
    contentLength === undefined ||
    !Number.isSafeInteger(contentLength) ||
    contentLength < minimum ||
    contentLength > policy.maxBytes
  ) {
    throw new MediaError('CONTENT_LENGTH_INVALID', 'The media content length is not accepted')
  }

  return { contentLength, contentType }
}
