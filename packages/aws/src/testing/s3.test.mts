import { S3Client } from '@aws-sdk/client-s3'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createTestS3Bucket,
  deleteS3Object,
  listS3Keys,
  listS3Versions,
  putS3Object,
  readS3ObjectBytes,
  readS3ObjectText,
  s3ObjectExists,
  sendToPresignedS3Url,
  uniqueS3Prefix,
} from './s3.mts'

const client = new S3Client({ region: 'us-west-2' })
const send = () => vi.spyOn(client, 'send') as unknown as ReturnType<typeof vi.fn>
const body = (text: string) => ({
  transformToString: async () => text,
  transformToByteArray: async () => new TextEncoder().encode(text),
})

afterEach(() => vi.restoreAllMocks())

describe('buckets and prefixes', () => {
  it('builds unique prefixes', () => {
    expect(uniqueS3Prefix('x')).toMatch(/^test\/x\/[0-9a-f-]{36}\/$/)
    expect(uniqueS3Prefix('x')).not.toBe(uniqueS3Prefix('x'))
  })

  it('creates lowercase bucket names capped at 63 characters, optionally versioned', async () => {
    const mock = send().mockResolvedValue({})
    const plain = await createTestS3Bucket(client, 'UPPER')
    expect(plain).toMatch(/^test-upper-/)
    expect(mock).toHaveBeenCalledTimes(1)
    const versioned = await createTestS3Bucket(client, 'v'.repeat(80), { versioned: true })
    expect(versioned).toHaveLength(63)
    expect(mock).toHaveBeenCalledTimes(3)
    expect(mock.mock.calls[2]?.[0].input.VersioningConfiguration).toEqual({ Status: 'Enabled' })
  })
})

describe('objects', () => {
  it('puts objects and returns the version id', async () => {
    const mock = send().mockResolvedValueOnce({ VersionId: 'v1' }).mockResolvedValueOnce({})
    expect(await putS3Object(client, { Bucket: 'b', Key: 'k', Body: 'x' })).toEqual({
      versionId: 'v1',
    })
    expect(await putS3Object(client, { Bucket: 'b', Key: 'k', Body: 'x' })).toEqual({})
    expect(mock).toHaveBeenCalledTimes(2)
  })

  it('reads text and bytes, mapping NoSuchKey and empty bodies to undefined', async () => {
    const mock = send()
    mock.mockResolvedValueOnce({ Body: body('hi') })
    expect(await readS3ObjectText(client, 'b', 'k')).toBe('hi')
    mock.mockResolvedValueOnce({ Body: body('hi') })
    expect(await readS3ObjectBytes(client, 'b', 'k')).toEqual(Buffer.from('hi'))
    mock.mockResolvedValueOnce({})
    expect(await readS3ObjectText(client, 'b', 'k')).toBeUndefined()
    mock.mockRejectedValueOnce(Object.assign(new Error('x'), { name: 'NoSuchKey' }))
    expect(await readS3ObjectBytes(client, 'b', 'k')).toBeUndefined()
    mock.mockRejectedValueOnce(new Error('boom'))
    await expect(readS3ObjectText(client, 'b', 'k')).rejects.toThrow('boom')
  })

  it('checks existence by HEAD status', async () => {
    const mock = send()
    mock.mockResolvedValueOnce({})
    expect(await s3ObjectExists(client, 'b', 'k')).toBe(true)
    mock.mockRejectedValueOnce({ $metadata: { httpStatusCode: 404 } })
    expect(await s3ObjectExists(client, 'b', 'k')).toBe(false)
    mock.mockRejectedValueOnce({ $metadata: { httpStatusCode: 500 } })
    await expect(s3ObjectExists(client, 'b', 'k')).rejects.toEqual({
      $metadata: { httpStatusCode: 500 },
    })
    mock.mockRejectedValueOnce(new Error('no metadata'))
    await expect(s3ObjectExists(client, 'b', 'k')).rejects.toThrow('no metadata')
  })

  it('deletes objects', async () => {
    const mock = send().mockResolvedValue({})
    await deleteS3Object(client, 'b', 'k')
    expect(mock.mock.calls[0]?.[0].input).toEqual({ Bucket: 'b', Key: 'k' })
  })
})

describe('listing', () => {
  it('lists sorted keys across pages and skips entries without keys', async () => {
    send()
      .mockResolvedValueOnce({ Contents: [{ Key: 'b' }, {}], NextContinuationToken: 't' })
      .mockResolvedValueOnce({ Contents: [{ Key: 'a' }] })
      .mockResolvedValueOnce({})
    expect(await listS3Keys(client, 'bucket', 'p/')).toEqual(['a', 'b'])
    expect(await listS3Keys(client, 'bucket', 'p/')).toEqual([])
  })

  it('lists versions and delete markers across pages', async () => {
    send()
      .mockResolvedValueOnce({
        Versions: [{ Key: 'k', VersionId: '1' }],
        DeleteMarkers: [{ Key: 'k', VersionId: '2' }],
        IsTruncated: true,
        NextKeyMarker: 'k',
        NextVersionIdMarker: '2',
      })
      .mockResolvedValueOnce({ Versions: [{ Key: 'j', VersionId: '3' }] })
      .mockResolvedValueOnce({})
    expect(await listS3Versions(client, 'b', 'p')).toEqual([
      { key: 'k', versionId: '1', deleteMarker: false },
      { key: 'k', versionId: '2', deleteMarker: true },
      { key: 'j', versionId: '3', deleteMarker: false },
    ])
    expect(await listS3Versions(client, 'b', 'p')).toEqual([])
  })
})

describe('sendToPresignedS3Url', () => {
  it('sends with the injected fetch and returns status and text', async () => {
    const fetchMock = vi.fn(async () => new Response('done', { status: 201 }))
    const bytes = new Uint8Array([1, 2])
    expect(
      await sendToPresignedS3Url(
        'https://u',
        { method: 'PUT', contentType: 'image/png', body: bytes },
        fetchMock,
      ),
    ).toEqual({ status: 201, body: 'done' })
    expect(fetchMock).toHaveBeenCalledWith('https://u', {
      method: 'PUT',
      headers: { 'content-type': 'image/png' },
      body: bytes,
    })
  })

  it('omits optional parts and defaults to the global fetch', async () => {
    const globalFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('ok'))
    expect(await sendToPresignedS3Url('https://u', { method: 'GET' })).toEqual({
      status: 200,
      body: 'ok',
    })
    expect(globalFetch).toHaveBeenCalledWith('https://u', { method: 'GET' })
  })
})
