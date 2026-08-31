export type MediaErrorCode = 'CONTENT_LENGTH_INVALID' | 'CONTENT_TYPE_INVALID' | 'POLICY_INVALID'

export class MediaError extends Error {
  readonly code: MediaErrorCode

  constructor(code: MediaErrorCode, message: string, options?: ErrorOptions) {
    super(message, options)
    this.name = 'MediaError'
    this.code = code
  }
}

export class MediaSizeLimitError extends Error {
  constructor(
    readonly maxBytes: number,
    readonly size: number,
  ) {
    super(`Media body exceeds the ${maxBytes}-byte limit`)
    this.name = 'MediaSizeLimitError'
  }
}
