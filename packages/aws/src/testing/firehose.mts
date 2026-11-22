import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import {
  CreateDeliveryStreamCommand,
  DescribeDeliveryStreamCommand,
  FirehoseClient,
} from '@aws-sdk/client-firehose'
import { CreateRoleCommand, IAMClient } from '@aws-sdk/client-iam'
import type { AwsEmulatorConnection } from './emulator.mts'

export interface ProvisionFirehoseStreamsOptions {
  /** Delivery stream names to create; the application under test derives them from its own config. */
  streamNames: readonly string[]
  /** Destination bucket and delivery role names. Default to `test-firehose`. */
  bucketName?: string
  roleName?: string
  /** How long to wait for every stream to become ACTIVE. Defaults to 30000. */
  activeDeadlineMs?: number
  /** Delay between status checks. Defaults to 1000. */
  pollIntervalMs?: number
}

/**
 * Creates one active DirectPut delivery stream per name, delivering into a destination bucket.
 * The emulator rejects a stream whose role does not exist and accepts records only once the
 * stream is ACTIVE (about three seconds after creation), so this waits for every stream.
 */
export async function provisionFirehoseStreams(
  emulator: AwsEmulatorConnection,
  options: ProvisionFirehoseStreamsOptions,
): Promise<void> {
  const bucket = options.bucketName ?? 'test-firehose'
  const config = {
    endpoint: emulator.endpoint,
    region: emulator.region,
    credentials: { accessKeyId: emulator.accessKeyId, secretAccessKey: emulator.secretAccessKey },
  }
  const s3 = new S3Client(config)
  const iam = new IAMClient(config)
  const firehose = new FirehoseClient(config)
  try {
    await s3.send(new CreateBucketCommand({ Bucket: bucket }))
    const { Role } = await iam.send(
      new CreateRoleCommand({
        RoleName: options.roleName ?? 'test-firehose',
        AssumeRolePolicyDocument: JSON.stringify({
          Version: '2012-10-17',
          Statement: [
            {
              Effect: 'Allow',
              Principal: { Service: 'firehose.amazonaws.com' },
              Action: 'sts:AssumeRole',
            },
          ],
        }),
      }),
    )
    await Promise.all(
      options.streamNames.map((DeliveryStreamName) =>
        firehose.send(
          new CreateDeliveryStreamCommand({
            DeliveryStreamName,
            DeliveryStreamType: 'DirectPut',
            ExtendedS3DestinationConfiguration: {
              RoleARN: Role?.Arn,
              BucketARN: `arn:aws:s3:::${bucket}`,
              Prefix: `${DeliveryStreamName}/`,
            },
          }),
        ),
      ),
    )
    const deadline = Date.now() + (options.activeDeadlineMs ?? 30_000)
    await Promise.all(
      options.streamNames.map((name) =>
        waitUntilActive(firehose, name, deadline, options.pollIntervalMs ?? 1_000),
      ),
    )
  } finally {
    s3.destroy()
    iam.destroy()
    firehose.destroy()
  }
}

async function waitUntilActive(
  client: FirehoseClient,
  DeliveryStreamName: string,
  deadline: number,
  pollIntervalMs: number,
): Promise<void> {
  for (;;) {
    const { DeliveryStreamDescription } = await client.send(
      new DescribeDeliveryStreamCommand({ DeliveryStreamName }),
    )
    const status = DeliveryStreamDescription?.DeliveryStreamStatus
    if (status === 'ACTIVE') return
    if (Date.now() >= deadline) {
      throw new Error(`Delivery stream ${DeliveryStreamName} is ${status}, not ACTIVE`)
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }
}
