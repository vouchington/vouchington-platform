import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import { createS3MediaStorage, S3MediaDeleteError } from './s3.mts'

vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async () => 'default-signed'),
}))

describe('S3 media storage', () => {
  it('presigns uploads with injected policy', async () => {
    const client = { send: vi.fn() } as unknown as S3Client
    let signedCommand: PutObjectCommand | undefined
    let signedOptions: { expiresIn?: number } | undefined
    const sign = vi.fn(
      async (_client: S3Client, command: object, options: { expiresIn?: number }) => {
        signedCommand = command as PutObjectCommand
        signedOptions = options
        return 'signed'
      },
    )
    const storage = createS3MediaStorage({ client, bucket: 'bucket', sign })
    await expect(
      storage.presignUpload({
        key: 'key',
        contentType: 'image/png',
        contentLength: 4,
        expiresInSeconds: 30,
      }),
    ).resolves.toBe('signed')
    expect(signedCommand).toBeInstanceOf(PutObjectCommand)
    expect(signedCommand?.input).toEqual({
      Bucket: 'bucket',
      Key: 'key',
      ContentLength: 4,
      ContentType: 'image/png',
      IfNoneMatch: '*',
    })
    expect(signedOptions).toEqual({ expiresIn: 30 })
  })

  it('gets and deletes objects', async () => {
    const body = (async function* () {
      yield Buffer.from('x')
    })()
    const send = vi.fn(async (command) =>
      command instanceof GetObjectCommand ? { Body: body } : {},
    )
    const storage = createS3MediaStorage({
      client: { send } as unknown as S3Client,
      bucket: 'bucket',
    })
    await expect(storage.getObject('key')).resolves.toBe(body)
    await storage.deleteObject('key')
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      input: { Bucket: 'bucket', Key: 'key' },
    })
    expect(send.mock.calls[1]?.[0]).toMatchObject({
      input: { Bucket: 'bucket', Key: 'key' },
    })
  })

  it('uses the default signer and permits an unspecified length', async () => {
    const client = { send: vi.fn() } as unknown as S3Client
    await expect(
      createS3MediaStorage({ client, bucket: 'bucket' }).presignUpload({
        key: 'key',
        contentType: 'image/png',
        expiresInSeconds: 60,
      }),
    ).resolves.toBe('default-signed')
    expect(getSignedUrl).toHaveBeenCalledOnce()
  })

  it.each([{}, { Body: null }, { Body: 'bytes' }, { Body: {} }])(
    'rejects an unreadable response body',
    async (output) => {
      const client = { send: vi.fn(async () => output) } as unknown as S3Client
      await expect(
        createS3MediaStorage({ client, bucket: 'bucket' }).getObject('key'),
      ).rejects.toThrow('unreadable')
    },
  )

  it('batches deletes and aggregates per-key failures', async () => {
    const send = vi.fn(async (command) => {
      if (!(command instanceof DeleteObjectsCommand)) return {}
      return command.input.Delete?.Objects?.[0]?.Key === 'key-1000'
        ? { Errors: [{ Key: 'key-1000', Code: 'Denied', Message: 'no' }, {}] }
        : {}
    })
    const storage = createS3MediaStorage({
      client: { send } as unknown as S3Client,
      bucket: 'bucket',
    })
    const keys = Array.from({ length: 1_001 }, (_, index) => `key-${index}`)
    await expect(storage.deleteObjects(keys)).rejects.toMatchObject({
      failures: [{ key: 'key-1000', code: 'Denied', message: 'no' }, {}],
    } satisfies Partial<S3MediaDeleteError>)
    expect(send).toHaveBeenCalledTimes(2)
    await expect(storage.deleteObjects([])).resolves.toBeUndefined()
  })

  it('supports successful bulk deletes', async () => {
    const client = { send: vi.fn(async () => ({ Errors: [] })) } as unknown as S3Client
    await expect(
      createS3MediaStorage({ client, bucket: 'bucket' }).deleteObjects(['key']),
    ).resolves.toBeUndefined()
  })

  it('attempts later batches after a batch request fails', async () => {
    const requestError = new Error('request')
    const send = vi.fn().mockRejectedValueOnce(requestError).mockResolvedValueOnce({ Errors: [] })
    const storage = createS3MediaStorage({
      client: { send } as unknown as S3Client,
      bucket: 'bucket',
    })
    const keys = Array.from({ length: 1_001 }, (_, index) => `key-${index}`)
    await expect(storage.deleteObjects(keys)).rejects.toMatchObject({
      failures: [{ cause: requestError, keys: keys.slice(0, 1_000) }],
    })
    expect(send).toHaveBeenCalledTimes(2)
  })
})
