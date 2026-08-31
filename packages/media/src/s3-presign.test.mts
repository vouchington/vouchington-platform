import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { createS3MediaUploadPresigner } from './s3-presign.mts'

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'default-signed'),
}))

describe('S3 media upload presigner', () => {
  it('presigns caller-selected conditional uploads with an injected signer', async () => {
    const client = { send: vi.fn() } as unknown as S3Client
    let signedCommand: PutObjectCommand | undefined
    let signedOptions: { expiresIn?: number } | undefined
    const sign = vi.fn(
      async (_client: S3Client, command: PutObjectCommand, options: { expiresIn?: number }) => {
        signedCommand = command
        signedOptions = options
        return 'signed'
      },
    )
    const presigner = createS3MediaUploadPresigner({ client, bucket: 'bucket', sign })
    await expect(
      presigner.presignUpload({
        key: 'key',
        contentType: 'image/png',
        contentLength: 4,
        expiresInSeconds: 30,
        ifNoneMatch: '*',
      }),
    ).resolves.toBe('signed')
    expect(signedCommand?.input).toEqual({
      Bucket: 'bucket',
      Key: 'key',
      ContentLength: 4,
      ContentType: 'image/png',
      IfNoneMatch: '*',
    })
    expect(signedOptions).toEqual({ expiresIn: 30 })
  })

  it('uses the default signer and permits an unspecified length', async () => {
    const client = { send: vi.fn() } as unknown as S3Client
    await expect(
      createS3MediaUploadPresigner({ client, bucket: 'bucket' }).presignUpload({
        key: 'key',
        contentType: 'image/png',
        expiresInSeconds: 60,
      }),
    ).resolves.toBe('default-signed')
    expect(getSignedUrl).toHaveBeenCalledOnce()
  })

  it('omits a conditional header unless the caller supplies one', async () => {
    let signedCommand: PutObjectCommand | undefined
    const presigner = createS3MediaUploadPresigner({
      client: { send: vi.fn() } as unknown as S3Client,
      bucket: 'bucket',
      sign: async (_client, command) => {
        signedCommand = command
        return 'signed'
      },
    })
    await presigner.presignUpload({
      key: 'key',
      contentType: 'image/png',
      expiresInSeconds: 30,
    })
    expect(signedCommand?.input).not.toHaveProperty('IfNoneMatch')
  })
})
