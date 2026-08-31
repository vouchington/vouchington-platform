import {
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { describe, expect, it, vi } from 'vitest'

import {
  createS3MediaObjects,
  S3MediaDeleteError,
  type S3MediaObject,
  type S3MediaPutObjectInput,
} from './s3.mts'

describe('S3 media objects', () => {
  it('gets object metadata and exposes caller-configurable writes', async () => {
    const body = (async function* () {
      yield Buffer.from('x')
    })()
    const send = vi.fn(async (command) =>
      command instanceof GetObjectCommand
        ? {
            Body: body,
            ContentLength: 1,
            ContentType: 'image/png',
            ETag: 'etag',
            Metadata: { source: 'test' },
          }
        : {},
    )
    const storage = createS3MediaObjects({
      client: { send } as unknown as S3Client,
      bucket: 'bucket',
    })
    const object: S3MediaObject = await storage.getObject('key')
    expect(object).toEqual({
      body,
      contentLength: 1,
      contentType: 'image/png',
      etag: 'etag',
      metadata: { source: 'test' },
    })
    const input: S3MediaPutObjectInput = {
      key: 'key',
      Body: Buffer.from('x'),
      CacheControl: 'public, max-age=60',
      Metadata: { source: 'test' },
    }
    await storage.putObject(input)
    await storage.delete('key')
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      input: { Bucket: 'bucket', Key: 'key' },
    })
    expect(send.mock.calls[1]?.[0]).toMatchObject({
      input: {
        Bucket: 'bucket',
        Key: 'key',
        CacheControl: 'public, max-age=60',
        Metadata: { source: 'test' },
      },
    })
    expect(send.mock.calls[1]?.[0]).toBeInstanceOf(PutObjectCommand)
    expect(send.mock.calls[2]?.[0]).toMatchObject({
      input: { Bucket: 'bucket', Key: 'key' },
    })
  })

  it('omits unavailable S3 response metadata', async () => {
    const body = (async function* () {
      yield Buffer.from('x')
    })()
    const client = { send: vi.fn(async () => ({ Body: body })) } as unknown as S3Client
    await expect(
      createS3MediaObjects({ client, bucket: 'bucket' }).getObject('key'),
    ).resolves.toEqual({ body })
  })

  it.each([{}, { Body: null }, { Body: 'bytes' }, { Body: {} }])(
    'rejects an unreadable response body',
    async (output) => {
      const client = { send: vi.fn(async () => output) } as unknown as S3Client
      await expect(
        createS3MediaObjects({ client, bucket: 'bucket' }).getObject('key'),
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
    const storage = createS3MediaObjects({
      client: { send } as unknown as S3Client,
      bucket: 'bucket',
    })
    const keys = Array.from({ length: 1_001 }, (_, index) => `key-${index}`)
    await expect(storage.deleteMany(keys)).rejects.toMatchObject({
      failures: [{ key: 'key-1000', code: 'Denied', message: 'no' }, {}],
    } satisfies Partial<S3MediaDeleteError>)
    expect(send).toHaveBeenCalledTimes(2)
    await expect(storage.deleteMany([])).resolves.toBeUndefined()
  })

  it('supports successful bulk deletes', async () => {
    const client = { send: vi.fn(async () => ({ Errors: [] })) } as unknown as S3Client
    await expect(
      createS3MediaObjects({ client, bucket: 'bucket' }).deleteMany(['key']),
    ).resolves.toBeUndefined()
  })

  it('attempts later batches after a batch request fails', async () => {
    const requestError = new Error('request')
    const send = vi.fn().mockRejectedValueOnce(requestError).mockResolvedValueOnce({ Errors: [] })
    const storage = createS3MediaObjects({
      client: { send } as unknown as S3Client,
      bucket: 'bucket',
    })
    const keys = Array.from({ length: 1_001 }, (_, index) => `key-${index}`)
    await expect(storage.deleteMany(keys)).rejects.toMatchObject({
      failures: [{ cause: requestError, keys: keys.slice(0, 1_000) }],
    })
    expect(send).toHaveBeenCalledTimes(2)
  })
})
