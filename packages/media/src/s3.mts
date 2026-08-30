import {
  DeleteObjectCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  PutObjectCommand,
  type S3Client,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

import type { MediaBody } from './types.mts'

export interface S3MediaStorageOptions {
  bucket: string
  client: S3Client
  sign?: (
    client: S3Client,
    command: PutObjectCommand,
    options: { expiresIn: number },
  ) => Promise<string>
}

export interface S3MediaStorage {
  deleteObject(key: string): Promise<void>
  deleteObjects(keys: readonly string[]): Promise<void>
  getObject(key: string): Promise<MediaBody>
  presignUpload(input: {
    contentLength?: number
    contentType: string
    expiresInSeconds: number
    key: string
  }): Promise<string>
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

export function createS3MediaStorage(options: S3MediaStorageOptions): S3MediaStorage {
  const sign =
    options.sign ?? ((client, command, signOptions) => getSignedUrl(client, command, signOptions))
  return {
    async presignUpload(input) {
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: input.key,
        ContentLength: input.contentLength,
        ContentType: input.contentType,
      })
      return sign(options.client, command, { expiresIn: input.expiresInSeconds })
    },
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
      return body as MediaBody
    },
    async deleteObject(key) {
      await options.client.send(new DeleteObjectCommand({ Bucket: options.bucket, Key: key }))
    },
    async deleteObjects(keys) {
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
