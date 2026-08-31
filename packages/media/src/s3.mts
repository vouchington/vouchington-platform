import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  type PutObjectCommandInput,
  type S3Client,
} from '@aws-sdk/client-s3'

import type { MediaBody } from './types.mts'

export interface S3MediaObjectsOptions {
  bucket: string
  client: S3Client
}

export interface S3MediaObjects {
  delete(key: string): Promise<void>
  deleteMany(keys: readonly string[]): Promise<void>
  getObject(key: string): Promise<S3MediaObject>
  putObject(input: S3MediaPutObjectInput): Promise<void>
}

export type S3MediaPutObjectInput = Omit<PutObjectCommandInput, 'Bucket' | 'Key'> & { key: string }

export interface S3MediaObject {
  body: MediaBody
  contentLength?: number
  contentType?: string
  etag?: string
  metadata?: Record<string, string>
}

export type S3MediaDeleteFailure =
  | { cause: unknown; keys: readonly string[] }
  | { code?: string; key?: string; message?: string }

export class S3MediaDeleteError extends Error {
  readonly failures: readonly S3MediaDeleteFailure[]

  constructor(failures: readonly S3MediaDeleteFailure[]) {
    super(`S3 failed to delete ${failures.length} media object(s)`)
    this.name = 'S3MediaDeleteError'
    this.failures = failures
  }
}

export function createS3MediaObjects(options: S3MediaObjectsOptions): S3MediaObjects {
  return {
    async getObject(key) {
      const output = await options.client.send(
        new GetObjectCommand({ Bucket: options.bucket, Key: key }),
      )
      const body: unknown = output.Body
      const iterator =
        typeof body === 'object' && body !== null
          ? (body as { [Symbol.asyncIterator]?: unknown })[Symbol.asyncIterator]
          : undefined
      if (typeof iterator !== 'function') {
        throw new TypeError('S3 returned an unreadable media body')
      }
      return {
        body: body as MediaBody,
        ...(output.ContentLength === undefined ? {} : { contentLength: output.ContentLength }),
        ...(output.ContentType === undefined ? {} : { contentType: output.ContentType }),
        ...(output.ETag === undefined ? {} : { etag: output.ETag }),
        ...(output.Metadata === undefined ? {} : { metadata: output.Metadata }),
      }
    },
    async putObject(input) {
      const { key, ...commandInput } = input
      await options.client.send(
        new PutObjectCommand({ Bucket: options.bucket, Key: key, ...commandInput }),
      )
    },
    async delete(key) {
      await options.client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }))
    },
    async deleteMany(keys) {
      const failures: S3MediaDeleteFailure[] = []
      for (let index = 0; index < keys.length; index += 1_000) {
        const batch = keys.slice(index, index + 1_000)
        let output
        try {
          output = await options.client.send(
            new DeleteObjectsCommand({
              Bucket: options.bucket,
              Delete: { Objects: batch.map((Key) => ({ Key })), Quiet: true },
            }),
          )
        } catch (cause) {
          failures.push({ cause, keys: batch })
          continue
        }
        for (const failure of output.Errors ?? []) {
          failures.push({
            ...(failure.Code === undefined ? {} : { code: failure.Code }),
            ...(failure.Key === undefined ? {} : { key: failure.Key }),
            ...(failure.Message === undefined ? {} : { message: failure.Message }),
          })
        }
      }
      if (failures.length > 0) throw new S3MediaDeleteError(failures)
    },
  }
}
