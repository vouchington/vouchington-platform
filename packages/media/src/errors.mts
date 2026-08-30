export type MediaErrorCode =
  | 'CONTENT_LENGTH_INVALID'
  | 'CONTENT_TYPE_INVALID'
  | 'DUPLICATE_MEDIA'
  | 'EXPIRY_INVALID'
  | 'INVALID_STATE'
  | 'MEDIA_NOT_FOUND'
  | 'POLICY_INVALID'
  | 'UNAUTHORIZED'

export class MediaError extends Error {
  readonly code: MediaErrorCode

  constructor(code: MediaErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MediaError'
    this.code = code
  }
}
