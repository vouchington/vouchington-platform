export interface MediaUploadPolicy {
  acceptsContentType(contentType: string): boolean
  maxBytes: number
  minBytes?: number
}

export interface ValidatedMediaUpload {
  contentLength: number
  contentType: string
}

export type MediaBody = AsyncIterable<Uint8Array>

export interface PendingMediaUpload {
  contentLength: number
  contentType: string
  id: string
  key: string
}

export interface CreatedMediaUpload<Record> extends PendingMediaUpload {
  expiresAt: Date
  record: Record
  uploadUrl: string
}
