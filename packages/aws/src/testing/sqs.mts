import { randomUUID } from 'node:crypto'
import {
  CreateQueueCommand,
  GetQueueAttributesCommand,
  SendMessageCommand,
  type SQSClient,
} from '@aws-sdk/client-sqs'

// Every helper takes the SQS client the test already points at the emulator. Build it with
// `useQueueUrlAsEndpoint: false`: queue URLs carry the real AWS host, and the explicit endpoint
// keeps requests on the emulator.

/** A queue owned by one test file, for workers that read their queue URL from the environment. */
export async function createTestSqsQueue(client: SQSClient, label: string): Promise<string> {
  const { QueueUrl } = await client.send(
    new CreateQueueCommand({ QueueName: `test-${label.slice(0, 38)}-${randomUUID()}` }),
  )
  if (!QueueUrl) throw new Error('The AWS Emulator returned no queue URL')
  return QueueUrl
}

export async function sendTestSqsMessage(
  client: SQSClient,
  QueueUrl: string,
  MessageBody: string,
): Promise<void> {
  await client.send(new SendMessageCommand({ QueueUrl, MessageBody }))
}

/** Messages neither visible nor in flight are gone; the sum is what a consumer has not deleted. */
export async function countTestSqsMessages(client: SQSClient, QueueUrl: string): Promise<number> {
  const { Attributes } = await client.send(
    new GetQueueAttributesCommand({
      QueueUrl,
      AttributeNames: ['ApproximateNumberOfMessages', 'ApproximateNumberOfMessagesNotVisible'],
    }),
  )
  return (
    Number(Attributes?.ApproximateNumberOfMessages ?? 0) +
    Number(Attributes?.ApproximateNumberOfMessagesNotVisible ?? 0)
  )
}
