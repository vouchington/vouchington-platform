import { randomUUID } from 'node:crypto'
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand,
  PutBucketVersioningCommand,
  PutObjectCommand,
  type PutObjectCommandInput,
  type S3Client,
} from '@aws-sdk/client-s3'

// Every helper takes the S3 client the test already points at the emulator, so a test can seed
// and inspect state without going through the code under test.

/** A key prefix no other test or concurrent fork can produce. */
export function uniqueS3Prefix(label: string): string {
  return `test/${label}/${randomUUID()}/`
}

/** A bucket owned by one test file, for code that reads its bucket name from the environment. */
export async function createTestS3Bucket(
  client: S3Client,
  label: string,
  options: { versioned?: boolean } = {},
): Promise<string> {
  // Truncate the label, never the random suffix, so concurrent tests keep distinct buckets.
  const Bucket = `test-${label.slice(0, 21)}-${randomUUID()}`.toLowerCase()
  await client.send(new CreateBucketCommand({ Bucket }))
  if (options.versioned) {
    await client.send(
      new PutBucketVersioningCommand({ Bucket, VersioningConfiguration: { Status: 'Enabled' } }),
    )
  }
  return Bucket
}

export async function putS3Object(
  client: S3Client,
  input: Omit<PutObjectCommandInput, 'Body'> & { Body: string | Uint8Array },
): Promise<{ versionId?: string }> {
  const result = await client.send(new PutObjectCommand(input))
  return result.VersionId === undefined ? {} : { versionId: result.VersionId }
}

async function readBody<T>(
  client: S3Client,
  Bucket: string,
  Key: string,
  read: (body: NonNullable<Awaited<ReturnType<typeof getBody>>>) => Promise<T>,
): Promise<T | undefined> {
  try {
    const body = await getBody(client, Bucket, Key)
    return body ? await read(body) : undefined
  } catch (err) {
    if ((err as { name?: string }).name === 'NoSuchKey') return undefined
    throw err
  }
}

async function getBody(client: S3Client, Bucket: string, Key: string) {
  return (await client.send(new GetObjectCommand({ Bucket, Key }))).Body
}

/** The object's text, or undefined when the key does not exist. */
export function readS3ObjectText(
  client: S3Client,
  Bucket: string,
  Key: string,
): Promise<string | undefined> {
  return readBody(client, Bucket, Key, (body) => body.transformToString())
}

/** The object's bytes, or undefined when the key does not exist. */
export function readS3ObjectBytes(
  client: S3Client,
  Bucket: string,
  Key: string,
): Promise<Buffer | undefined> {
  return readBody(client, Bucket, Key, async (body) =>
    Buffer.from(await body.transformToByteArray()),
  )
}

export async function s3ObjectExists(
  client: S3Client,
  Bucket: string,
  Key: string,
): Promise<boolean> {
  try {
    await client.send(new HeadObjectCommand({ Bucket, Key }))
    return true
  } catch (err) {
    if ((err as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) {
      return false
    }
    throw err
  }
}

/** Every current key under a prefix, sorted. */
export async function listS3Keys(
  client: S3Client,
  Bucket: string,
  Prefix: string,
): Promise<string[]> {
  const keys: string[] = []
  let ContinuationToken: string | undefined
  do {
    const page = await client.send(new ListObjectsV2Command({ Bucket, Prefix, ContinuationToken }))
    keys.push(...(page.Contents ?? []).flatMap((object) => (object.Key ? [object.Key] : [])))
    ContinuationToken = page.NextContinuationToken
  } while (ContinuationToken)
  return keys.toSorted()
}

export interface S3VersionEntry {
  key: string
  versionId: string
  deleteMarker: boolean
}

/** Every version and delete marker under a prefix, for versioned buckets. */
export async function listS3Versions(
  client: S3Client,
  Bucket: string,
  Prefix: string,
): Promise<S3VersionEntry[]> {
  const versions: S3VersionEntry[] = []
  let KeyMarker: string | undefined
  let VersionIdMarker: string | undefined
  let truncated: boolean | undefined
  do {
    const page = await client.send(
      new ListObjectVersionsCommand({ Bucket, Prefix, KeyMarker, VersionIdMarker }),
    )
    for (const v of page.Versions ?? []) {
      versions.push({ key: v.Key!, versionId: v.VersionId!, deleteMarker: false })
    }
    for (const v of page.DeleteMarkers ?? []) {
      versions.push({ key: v.Key!, versionId: v.VersionId!, deleteMarker: true })
    }
    KeyMarker = page.NextKeyMarker
    VersionIdMarker = page.NextVersionIdMarker
    truncated = page.IsTruncated
  } while (truncated)
  return versions
}

export async function deleteS3Object(client: S3Client, Bucket: string, Key: string): Promise<void> {
  await client.send(new DeleteObjectCommand({ Bucket, Key }))
}

/**
 * Sends a request to a presigned URL the way a browser would. The fetch is injectable for
 * environments that need a custom dispatcher; it defaults to the global fetch.
 */
export async function sendToPresignedS3Url(
  url: string,
  init: { method: 'GET' | 'PUT'; contentType?: string; body?: Uint8Array },
  doFetch: typeof fetch = fetch,
): Promise<{ status: number; body: string }> {
  const response = await doFetch(url, {
    method: init.method,
    ...(init.contentType ? { headers: { 'content-type': init.contentType } } : {}),
    ...(init.body ? { body: init.body } : {}),
  })
  return { status: response.status, body: await response.text() }
}
