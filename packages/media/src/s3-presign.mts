import { PutObjectCommand, type S3Client } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'

export interface S3MediaUploadPresignerOptions {
  bucket: string
  client: S3Client
  sign?: (
    client: S3Client,
    command: PutObjectCommand,
    options: { expiresIn: number },
  ) => Promise<string>
}

export interface S3MediaUploadPresigner {
  presignUpload(input: {
    contentLength?: number
    contentType: string
    expiresInSeconds: number
    ifNoneMatch?: string
    key: string
  }): Promise<string>
}

export function createS3MediaUploadPresigner(
  options: S3MediaUploadPresignerOptions,
): S3MediaUploadPresigner {
  const sign =
    options.sign ?? ((client, command, signOptions) => getSignedUrl(client, command, signOptions))
  return {
    async presignUpload(input) {
      const command = new PutObjectCommand({
        Bucket: options.bucket,
        Key: input.key,
        ContentLength: input.contentLength,
        ContentType: input.contentType,
        ...(input.ifNoneMatch === undefined ? {} : { IfNoneMatch: input.ifNoneMatch }),
      })
      return sign(options.client, command, { expiresIn: input.expiresInSeconds })
    },
  }
}
