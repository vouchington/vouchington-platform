import sharp from 'sharp'

export interface ImageMetadata {
  format: string | undefined
  width: number | undefined
  height: number | undefined
  hasAlpha: boolean
  channels: number | undefined
  space: string | undefined
  orientation: number | undefined
}

export interface InspectImageOptions {
  maxInputPixels?: number | boolean
}

export async function inspectImage(
  input: Uint8Array,
  options: InspectImageOptions = {},
): Promise<ImageMetadata> {
  const metadata = await sharp(input, { limitInputPixels: options.maxInputPixels }).metadata()
  return {
    format: metadata.format,
    width: metadata.width,
    height: metadata.height,
    hasAlpha: metadata.hasAlpha === true,
    channels: metadata.channels,
    space: metadata.space,
    orientation: metadata.orientation,
  }
}
