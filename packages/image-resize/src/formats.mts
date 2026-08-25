import Negotiator from 'negotiator'

export const IMAGE_OUTPUT_FORMATS = ['avif', 'webp', 'png', 'jpeg'] as const
export type ImageOutputFormat = (typeof IMAGE_OUTPUT_FORMATS)[number]

const MIME_TYPES: Record<ImageOutputFormat, string> = {
  avif: 'image/avif',
  webp: 'image/webp',
  png: 'image/png',
  jpeg: 'image/jpeg',
}

export interface NegotiateImageFormatOptions {
  accept?: string
  requested?: ImageOutputFormat
  supported?: readonly ImageOutputFormat[]
  fallback?: ImageOutputFormat
}

export function negotiateImageFormat(options: NegotiateImageFormatOptions = {}): ImageOutputFormat {
  const supported = options.supported ?? IMAGE_OUTPUT_FORMATS
  const fallback = options.fallback ?? supported[0]
  if (fallback === undefined || !supported.includes(fallback)) {
    throw new RangeError('fallback must be one of the supported image formats')
  }
  if (options.requested !== undefined) {
    if (!supported.includes(options.requested))
      throw new RangeError('requested image format is not supported')
    return options.requested
  }
  if (options.accept === undefined || options.accept.trim() === '') return fallback
  const mimeToFormat = new Map(supported.map((format) => [MIME_TYPES[format], format]))
  const mediaType = new Negotiator({ headers: { accept: options.accept } }).mediaType([
    ...mimeToFormat.keys(),
  ])
  return mediaType === undefined ? fallback : mimeToFormat.get(mediaType)!
}

export function imageFormatContentType(format: ImageOutputFormat): string {
  return MIME_TYPES[format]
}
