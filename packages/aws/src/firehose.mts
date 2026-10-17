import {
  PutRecordBatchCommand,
  type PutRecordBatchOutput,
  type _Record,
} from '@aws-sdk/client-firehose'
import { byteLength, chunkBySize } from './chunk.mts'

const FIREHOSE_MAX_RECORDS_PER_BATCH = 500
const FIREHOSE_MAX_BATCH_BYTES = 4 * 1024 * 1024
const FIREHOSE_MAX_RECORD_BYTES = 1_000 * 1024

// Serializes a value as a delimiter-terminated JSON record (newline by default for S3 sinks).
export function encodeJsonRecord(value: unknown, delimiter = '\n'): Uint8Array {
  return Buffer.from(`${JSON.stringify(value)}${delimiter}`, 'utf8')
}

// Splits records by Firehose count and byte limits. A record over the per-record limit throws.
export function chunkFirehoseRecords(records: readonly Uint8Array[]): Uint8Array[][] {
  return chunkBySize(records, {
    maxItems: FIREHOSE_MAX_RECORDS_PER_BATCH,
    maxBytes: FIREHOSE_MAX_BATCH_BYTES,
    sizeOf: (record) => {
      const size = byteLength(record)
      if (size > FIREHOSE_MAX_RECORD_BYTES) {
        throw new RangeError(
          `Firehose record of ${size} bytes exceeds ${FIREHOSE_MAX_RECORD_BYTES}`,
        )
      }
      return size
    },
  })
}

export function buildPutRecordBatchCommand(
  deliveryStreamName: string,
  records: readonly Uint8Array[],
): PutRecordBatchCommand {
  const Records: _Record[] = records.map((Data) => ({ Data }))
  return new PutRecordBatchCommand({ DeliveryStreamName: deliveryStreamName, Records })
}

// Returns the input records Firehose rejected, aligned by index. The caller decides whether to retry.
export function getFailedFirehoseRecords(
  records: readonly Uint8Array[],
  output: Partial<Pick<PutRecordBatchOutput, 'FailedPutCount' | 'RequestResponses'>>,
): Uint8Array[] {
  if (!output.FailedPutCount) return []
  const failed: Uint8Array[] = []
  for (const [index, response] of (output.RequestResponses ?? []).entries()) {
    const record = records[index]
    if (response.ErrorCode && record) failed.push(record)
  }
  return failed
}
