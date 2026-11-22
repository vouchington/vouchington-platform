import { CreateBucketCommand, S3Client } from '@aws-sdk/client-s3'
import { DescribeDeliveryStreamCommand, FirehoseClient } from '@aws-sdk/client-firehose'
import { CreateRoleCommand, IAMClient } from '@aws-sdk/client-iam'
import { SQSClient } from '@aws-sdk/client-sqs'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { provisionFirehoseStreams } from './firehose.mts'
import { countTestSqsMessages, createTestSqsQueue, sendTestSqsMessage } from './sqs.mts'

afterEach(() => vi.restoreAllMocks())

const connection = {
  endpoint: 'https://127.0.0.1:1',
  region: 'us-west-2',
  caPem: 'CA',
  accessKeyId: 'AKIA',
  secretAccessKey: 'SECRET',
}

describe('sqs helpers', () => {
  const client = new SQSClient({ region: 'us-west-2' })

  it('creates a uniquely named queue and rejects a missing URL', async () => {
    const send = vi.spyOn(client, 'send') as unknown as ReturnType<typeof vi.fn>
    send.mockResolvedValueOnce({ QueueUrl: 'https://q/1' })
    expect(await createTestSqsQueue(client, 'jobs')).toBe('https://q/1')
    expect(send.mock.calls[0]?.[0].input.QueueName).toMatch(/^test-jobs-[0-9a-f-]{36}$/)
    send.mockResolvedValueOnce({})
    await expect(createTestSqsQueue(client, 'jobs')).rejects.toThrow('returned no queue URL')
  })

  it('truncates long labels to the SQS name limit', async () => {
    const send = vi.spyOn(client, 'send') as unknown as ReturnType<typeof vi.fn>
    send.mockResolvedValue({ QueueUrl: 'u' })
    await createTestSqsQueue(client, 'x'.repeat(200))
    const name = send.mock.calls[0]?.[0].input.QueueName
    expect(name).toHaveLength(80)
    expect(name).toMatch(/-[0-9a-f-]{36}$/)
  })

  it('sends messages and sums visible and in-flight counts', async () => {
    const send = vi.spyOn(client, 'send') as unknown as ReturnType<typeof vi.fn>
    send.mockResolvedValue({})
    await sendTestSqsMessage(client, 'u', 'body')
    expect(send.mock.calls[0]?.[0].input).toEqual({ QueueUrl: 'u', MessageBody: 'body' })
    send.mockResolvedValueOnce({
      Attributes: { ApproximateNumberOfMessages: '2', ApproximateNumberOfMessagesNotVisible: '3' },
    })
    expect(await countTestSqsMessages(client, 'u')).toBe(5)
    send.mockResolvedValueOnce({})
    expect(await countTestSqsMessages(client, 'u')).toBe(0)
  })
})

describe('provisionFirehoseStreams', () => {
  function mockClients(statuses: string[]) {
    const s3 = vi.spyOn(S3Client.prototype, 'send') as unknown as ReturnType<typeof vi.fn>
    const iam = vi.spyOn(IAMClient.prototype, 'send') as unknown as ReturnType<typeof vi.fn>
    const firehose = vi.spyOn(FirehoseClient.prototype, 'send') as unknown as ReturnType<
      typeof vi.fn
    >
    s3.mockResolvedValue({})
    iam.mockResolvedValue({ Role: { Arn: 'arn:role' } })
    firehose.mockImplementation(async (command: unknown) =>
      command instanceof DescribeDeliveryStreamCommand
        ? { DeliveryStreamDescription: { DeliveryStreamStatus: statuses.shift() ?? 'ACTIVE' } }
        : {},
    )
    return { s3, iam, firehose }
  }

  it('creates the bucket, role and streams, then waits until every stream is ACTIVE', async () => {
    const { s3, iam, firehose } = mockClients(['CREATING', 'ACTIVE', 'ACTIVE'])
    await provisionFirehoseStreams(connection, {
      streamNames: ['p-a', 'p-b'],
      bucketName: 'dest',
      roleName: 'role',
      pollIntervalMs: 1,
    })
    expect(s3.mock.calls[0]?.[0]).toBeInstanceOf(CreateBucketCommand)
    expect(s3.mock.calls[0]?.[0].input).toEqual({ Bucket: 'dest' })
    expect(iam.mock.calls[0]?.[0]).toBeInstanceOf(CreateRoleCommand)
    expect(iam.mock.calls[0]?.[0].input.RoleName).toBe('role')
    const created = firehose.mock.calls
      .map(([command]) => command.input)
      .filter((input) => input.DeliveryStreamType)
    expect(created.map((input) => input.DeliveryStreamName)).toEqual(['p-a', 'p-b'])
    expect(created[0].ExtendedS3DestinationConfiguration).toEqual({
      RoleARN: 'arn:role',
      BucketARN: 'arn:aws:s3:::dest',
      Prefix: 'p-a/',
    })
    expect(
      firehose.mock.calls.filter(([c]) => c instanceof DescribeDeliveryStreamCommand),
    ).toHaveLength(3)
  })

  it('uses default names and fails when a stream never becomes ACTIVE', async () => {
    const { s3, iam } = mockClients(Array.from({ length: 100 }, () => 'CREATING'))
    await expect(
      provisionFirehoseStreams(connection, {
        streamNames: ['s'],
        activeDeadlineMs: 0,
      }),
    ).rejects.toThrow('Delivery stream s is CREATING, not ACTIVE')
    expect(s3.mock.calls[0]?.[0].input.Bucket).toBe('test-firehose')
    expect(iam.mock.calls[0]?.[0].input.RoleName).toBe('test-firehose')
  })

  it('reports a stream with no description as not ACTIVE', async () => {
    const { firehose } = mockClients([])
    firehose.mockResolvedValue({})
    await expect(
      provisionFirehoseStreams(connection, { streamNames: ['s'], activeDeadlineMs: 0 }),
    ).rejects.toThrow('is undefined, not ACTIVE')
  })

  it('polls once per second by default', async () => {
    vi.useFakeTimers()
    mockClients(['CREATING'])
    const done = provisionFirehoseStreams(connection, { streamNames: ['s'] })
    await vi.advanceTimersByTimeAsync(1_000)
    await done
    vi.useRealTimers()
  })
})
