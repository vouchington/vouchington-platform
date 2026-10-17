import {
  DeleteMessageBatchCommand,
  ReceiveMessageCommand,
  SendMessageBatchCommand,
  type BatchResultErrorEntry,
  type DeleteMessageBatchRequestEntry,
  type MessageAttributeValue,
  type SendMessageBatchRequestEntry,
} from '@aws-sdk/client-sqs'
import { byteLength, chunkBySize } from './chunk.mts'
import { AWS_DUALSTACK_CLIENT_CONFIG } from './request-handler.mts'

const SQS_MAX_BATCH_ENTRIES = 10
const SQS_MAX_BATCH_BYTES = 1_048_576

// Client options for the application's SQSClient. QueueUrls use the IPv4 host, and the SDK default
// useQueueUrlAsEndpoint would override the resolved dual-stack endpoint on every call.
export const SQS_CLIENT_CONFIG = {
  ...AWS_DUALSTACK_CLIENT_CONFIG,
  useQueueUrlAsEndpoint: false,
} as const

export type SqsAttributeInput = string | number | Uint8Array

export function encodeMessageAttributes(
  attributes: Readonly<Record<string, SqsAttributeInput>>,
): Record<string, MessageAttributeValue> {
  const encoded: Record<string, MessageAttributeValue> = {}
  for (const [name, value] of Object.entries(attributes)) {
    if (typeof value === 'string') encoded[name] = { DataType: 'String', StringValue: value }
    else if (typeof value === 'number') {
      encoded[name] = { DataType: 'Number', StringValue: String(value) }
    } else encoded[name] = { DataType: 'Binary', BinaryValue: value }
  }
  return encoded
}

export function decodeMessageAttributes(
  attributes: Readonly<Record<string, MessageAttributeValue>> | undefined,
): Record<string, SqsAttributeInput> {
  const decoded: Record<string, SqsAttributeInput> = {}
  for (const [name, attribute] of Object.entries(attributes ?? {})) {
    if (attribute.DataType?.startsWith('Binary') && attribute.BinaryValue) {
      decoded[name] = attribute.BinaryValue
    } else if (attribute.StringValue !== undefined) {
      // Number attributes stay strings: SQS allows 38 digits, which a JS number would round.
      decoded[name] = attribute.StringValue
    }
  }
  return decoded
}

function entrySize(entry: SendMessageBatchRequestEntry): number {
  let size = byteLength(entry.MessageBody ?? '')
  for (const [name, value] of Object.entries(entry.MessageAttributes ?? {})) {
    size += byteLength(name) + byteLength(value.DataType ?? '')
    size += value.BinaryValue ? value.BinaryValue.byteLength : byteLength(value.StringValue ?? '')
  }
  return size
}

// Splits entries into SendMessageBatch-sized groups (10 entries, 1 MiB). Oversized entries throw.
export function chunkSendEntries(
  entries: readonly SendMessageBatchRequestEntry[],
): SendMessageBatchRequestEntry[][] {
  return chunkBySize(entries, {
    maxItems: SQS_MAX_BATCH_ENTRIES,
    maxBytes: SQS_MAX_BATCH_BYTES,
    sizeOf: entrySize,
  })
}

export function chunkDeleteEntries(
  entries: readonly DeleteMessageBatchRequestEntry[],
): DeleteMessageBatchRequestEntry[][] {
  return chunkBySize(entries, {
    maxItems: SQS_MAX_BATCH_ENTRIES,
    maxBytes: Number.MAX_SAFE_INTEGER,
    sizeOf: () => 0,
  })
}

export function buildSendMessageBatchCommand(
  queueUrl: string,
  entries: readonly SendMessageBatchRequestEntry[],
): SendMessageBatchCommand {
  return new SendMessageBatchCommand({ QueueUrl: queueUrl, Entries: [...entries] })
}

export function buildDeleteMessageBatchCommand(
  queueUrl: string,
  entries: readonly DeleteMessageBatchRequestEntry[],
): DeleteMessageBatchCommand {
  return new DeleteMessageBatchCommand({ QueueUrl: queueUrl, Entries: [...entries] })
}

export interface ReceiveOptions {
  maxMessages?: number
  waitTimeSeconds?: number
  visibilityTimeoutSeconds?: number
}

// One receive call, long-polling by default (20s). Pair with AWS_LONG_POLL_SOCKET_TIMEOUT_MS.
export function buildReceiveMessageCommand(
  queueUrl: string,
  options: ReceiveOptions = {},
): ReceiveMessageCommand {
  return new ReceiveMessageCommand({
    QueueUrl: queueUrl,
    MaxNumberOfMessages: options.maxMessages ?? SQS_MAX_BATCH_ENTRIES,
    WaitTimeSeconds: options.waitTimeSeconds ?? 20,
    MessageAttributeNames: ['All'],
    ...(options.visibilityTimeoutSeconds === undefined
      ? {}
      : { VisibilityTimeout: options.visibilityTimeoutSeconds }),
  })
}

// Splits a batch result's failures into sender faults (do not retry) and the rest.
export function classifyBatchFailures(failed: readonly BatchResultErrorEntry[] | undefined): {
  senderFault: BatchResultErrorEntry[]
  retryable: BatchResultErrorEntry[]
} {
  const senderFault: BatchResultErrorEntry[] = []
  const retryable: BatchResultErrorEntry[] = []
  for (const entry of failed ?? []) (entry.SenderFault ? senderFault : retryable).push(entry)
  return { senderFault, retryable }
}
