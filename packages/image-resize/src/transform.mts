import sharp, { type Sharp } from 'sharp'
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

export type ImageInput = Uint8Array | string

export class ImageTransformError extends Error {
  constructor(
    message: string,
    readonly cause: unknown,
  ) {
    super(message)
    this.name = 'ImageTransformError'
  }
}

export class ImageInputPixelLimitError extends ImageTransformError {
  constructor(
    readonly maxInputPixels: number | boolean | undefined,
    cause: unknown,
  ) {
    super('Image input exceeds the configured pixel limit', cause)
    this.name = 'ImageInputPixelLimitError'
  }
}

export async function transformImage(
  input: ImageInput,
  options: TransformImageOptions,
): Promise<Buffer> {
  return transform(input, options, (pipeline) => pipeline.toBuffer())
}

export async function transformImageToFile(
  input: ImageInput,
  outputPath: string,
  options: TransformImageOptions,
): Promise<void> {
  await transform(input, options, (pipeline) => pipeline.toFile(outputPath))
}

async function transform<Result>(
  input: ImageInput,
  options: TransformImageOptions,
  output: (pipeline: Sharp) => Promise<Result>,
): Promise<Result> {
  validateOptions(options)
  try {
    const pipeline = sharp(input, {
      limitInputPixels: options.maxInputPixels,
      sequentialRead: true,
    })
    const metadata = await pipeline.metadata()
    const isGrayscale =
      metadata.space === 'b-w' || (metadata.channels === 1 && metadata.hasAlpha !== true)
    const hasAlpha =
      metadata.hasAlpha === true || (metadata.channels === 4 && metadata.space !== 'cmyk')
    pipeline.rotate().resize({
      width: options.width,
      height: options.height,
      fit: 'inside',
      withoutEnlargement: true,
    })
    if (isGrayscale && !hasAlpha) pipeline.toColorspace('b-w')
    switch (options.format) {
      case 'avif':
        pipeline.avif({
          quality: options.quality,
          lossless: options.lossless,
          chromaSubsampling: '4:2:0',
        })
        break
      case 'webp':
        pipeline.webp({
          quality: options.quality,
          lossless: options.lossless,
          alphaQuality: hasAlpha ? options.quality : undefined,
        })
        break
      case 'png':
        pipeline.png({
          progressive: options.progressive,
          compressionLevel: options.lossless ? 9 : 6,
          palette: !hasAlpha && !isGrayscale,
        })
        break
      case 'jpeg':
        if (hasAlpha)
          pipeline.flatten({ background: options.flattenBackground ?? { r: 255, g: 255, b: 255 } })
        pipeline.jpeg({ quality: options.quality, progressive: options.progressive, mozjpeg: true })
        break
    }
    return await output(pipeline)
  } catch (error) {
    if (isPixelLimitError(error)) throw new ImageInputPixelLimitError(options.maxInputPixels, error)
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

function isPixelLimitError(error: unknown): boolean {
  return error instanceof Error && /exceeds pixel limit/i.test(error.message)
}
