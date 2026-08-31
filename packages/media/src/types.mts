export interface MediaUploadPolicy {
  acceptsContentType(contentType: string): boolean
  maxBytes: number
  minBytes?: number
}

export interface ValidatedMediaUpload {
  contentLength: number
  contentType: string
}

export type MediaBody = AsyncIterable<Uint8Array> & { destroy?(): void }
