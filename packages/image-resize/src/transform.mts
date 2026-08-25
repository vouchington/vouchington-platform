import sharp from 'sharp'
import { IMAGE_OUTPUT_FORMATS, type ImageOutputFormat } from './formats.mts'

export interface TransformImageOptions {
  width: number
  height?: number
  format: ImageOutputFormat
  quality?: number
  lossless?: boolean
  progressive?: boolean
  maxInputPixels?: number | boolean
  flattenBackground?: { r: number; g: number; b: number; alpha?: number }
}

export class ImageTransformError extends Error {
  constructor(
    message: string,
    readonly cause: unknown,
  ) {
    super(message)
    this.name = 'ImageTransformError'
  }
}

export async function transformImage(
  input: Uint8Array,
  options: TransformImageOptions,
): Promise<Buffer> {
  validateOptions(options)
  try {
    const pipeline = sharp(input, { limitInputPixels: options.maxInputPixels }).rotate().resize({
      width: options.width,
      height: options.height,
      fit: 'inside',
      withoutEnlargement: true,
    })
    switch (options.format) {
      case 'avif':
        pipeline.avif({ quality: options.quality, lossless: options.lossless })
        break
      case 'webp':
        pipeline.webp({ quality: options.quality, lossless: options.lossless })
        break
      case 'png':
        pipeline.png({
          progressive: options.progressive,
          compressionLevel: options.lossless ? 9 : 6,
        })
        break
      case 'jpeg':
        if (options.flattenBackground !== undefined)
          pipeline.flatten({ background: options.flattenBackground })
        pipeline.jpeg({ quality: options.quality, progressive: options.progressive, mozjpeg: true })
        break
    }
    return await pipeline.toBuffer()
  } catch (error) {
    throw new ImageTransformError(`Image transformation failed: ${String(error)}`, error)
  }
}

function validateOptions(options: TransformImageOptions): void {
  if (!isPositiveSafeInteger(options.width)) {
    throw new RangeError('width must be a positive safe integer')
  }
  if (options.height !== undefined && !isPositiveSafeInteger(options.height)) {
    throw new RangeError('height must be a positive safe integer')
  }
  if (
    options.quality !== undefined &&
    (!Number.isSafeInteger(options.quality) || options.quality < 1 || options.quality > 100)
  ) {
    throw new RangeError('quality must be an integer from 1 through 100')
  }
  if (!IMAGE_OUTPUT_FORMATS.includes(options.format)) {
    throw new RangeError('format must be a supported image output format')
  }
  if (
    options.maxInputPixels !== undefined &&
    typeof options.maxInputPixels !== 'boolean' &&
    !isPositiveSafeInteger(options.maxInputPixels)
  ) {
    throw new RangeError('maxInputPixels must be a boolean or a positive safe integer')
  }
}

function isPositiveSafeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0
}
