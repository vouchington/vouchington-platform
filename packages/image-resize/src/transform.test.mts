import { describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { inspectImage } from './metadata.mts'
import { ImageTransformError, transformImage } from './transform.mts'

const source = () =>
  sharp({ create: { width: 20, height: 10, channels: 4, background: 'red' } })
    .png()
    .toBuffer()

describe('image transforms', () => {
  it('resizes bytes without enlarging and exposes metadata', async () => {
    const output = await transformImage(await source(), { width: 10, format: 'webp', quality: 80 })
    await expect(inspectImage(output)).resolves.toMatchObject({
      format: 'webp',
      width: 10,
      height: 5,
    })
    const same = await transformImage(await source(), { width: 30, format: 'png' })
    await expect(inspectImage(same, { maxInputPixels: false })).resolves.toMatchObject({
      width: 20,
      hasAlpha: true,
    })
  })

  it('inspects an image from a local file path', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'image-resize-'))
    const path = join(directory, 'source.png')
    try {
      await writeFile(path, await source())
      await expect(inspectImage(path)).resolves.toMatchObject({ format: 'png', width: 20 })
    } finally {
      await rm(directory, { force: true, recursive: true })
    }
  })

  it('supports each encoder and flattening JPEG alpha', async () => {
    const input = await source()
    for (const format of ['avif', 'png'] as const) {
      await expect(
        transformImage(input, { width: 10, format, lossless: true, progressive: true }),
      ).resolves.toBeInstanceOf(Buffer)
    }
    const jpeg = await transformImage(input, {
      width: 10,
      format: 'jpeg',
      flattenBackground: { r: 255, g: 255, b: 255 },
    })
    await expect(inspectImage(jpeg)).resolves.toMatchObject({ format: 'jpeg', hasAlpha: false })
    await expect(transformImage(input, { width: 10, format: 'jpeg' })).resolves.toBeInstanceOf(
      Buffer,
    )
  })

  it('validates options and wraps sharp failures', async () => {
    await expect(transformImage(await source(), {} as never)).rejects.toThrow('width')
    await expect(transformImage(await source(), { width: 0, format: 'png' })).rejects.toThrow(
      'width',
    )
    await expect(
      transformImage(await source(), { width: 1, format: 'png', height: -1 }),
    ).rejects.toThrow('height')
    await expect(
      transformImage(await source(), { width: 1, format: 'png', quality: 101 }),
    ).rejects.toThrow('quality')
    await expect(
      transformImage(await source(), { width: 1, format: 'gif' as never }),
    ).rejects.toThrow('format')
    await expect(
      transformImage(await source(), { width: 1, format: 'png', maxInputPixels: 0 }),
    ).rejects.toThrow('maxInputPixels')
    for (const maxInputPixels of [true, false, 1000] as const) {
      await expect(
        transformImage(await source(), { width: 1, format: 'png', maxInputPixels }),
      ).resolves.toBeInstanceOf(Buffer)
    }
    await expect(
      transformImage(Buffer.from('not an image'), { width: 1, format: 'png' }),
    ).rejects.toBeInstanceOf(ImageTransformError)
  })
})
