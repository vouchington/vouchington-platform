import { describe, expect, it } from 'vitest'
import {
  buildPutMetricDataCommand,
  CLOUDWATCH_MAX_METRICS_PER_REQUEST,
  chunkMetricData,
} from './cloudwatch.mts'
import { chunkBySize, byteLength } from './chunk.mts'
import { getAwsErrorStatus, isAwsThrottlingError } from './errors.mts'
import {
  buildPutRecordBatchCommand,
  chunkFirehoseRecords,
  encodeJsonRecord,
  getFailedFirehoseRecords,
} from './firehose.mts'

describe('chunkBySize', () => {
  it('handles empty input and byte lengths', () => {
    expect(chunkBySize([], { maxItems: 1, maxBytes: 1, sizeOf: () => 0 })).toEqual([])
    expect(byteLength('é')).toBe(2)
    expect(byteLength(new Uint8Array(3))).toBe(3)
  })
})

describe('cloudwatch', () => {
  it('chunks metric data at the request limit', () => {
    const data = Array.from({ length: CLOUDWATCH_MAX_METRICS_PER_REQUEST + 1 }, () => ({
      MetricName: 'm',
    }))
    expect(chunkMetricData(data).map((chunk) => chunk.length)).toEqual([1_000, 1])
    expect(chunkMetricData(data, { maxItems: 600 })).toHaveLength(2)
  })

  it('chunks by serialized size and rejects oversized datums', () => {
    const datum = { MetricName: 'x'.repeat(100) }
    const chunks = chunkMetricData([datum, datum, datum], { maxBytes: 200 })
    expect(chunks.map((chunk) => chunk.length)).toEqual([1, 1, 1])
    expect(() => chunkMetricData([datum], { maxBytes: 10 })).toThrow(RangeError)
  })

  it('builds PutMetricData', () => {
    expect(buildPutMetricDataCommand('ns', [{ MetricName: 'm', Value: 1 }]).input).toEqual({
      Namespace: 'ns',
      MetricData: [{ MetricName: 'm', Value: 1 }],
    })
  })
})

describe('firehose', () => {
  it('encodes delimited JSON records', () => {
    expect(Buffer.from(encodeJsonRecord({ a: 1 })).toString()).toBe('{"a":1}\n')
    expect(Buffer.from(encodeJsonRecord({ a: 1 }, '')).toString()).toBe('{"a":1}')
    expect(() => encodeJsonRecord(undefined)).toThrow(TypeError)
  })

  it('chunks by count and bytes and rejects oversized records', () => {
    const small = Array.from({ length: 501 }, () => new Uint8Array(1))
    expect(chunkFirehoseRecords(small).map((chunk) => chunk.length)).toEqual([500, 1])
    const large = Array.from({ length: 5 }, () => new Uint8Array(1_000 * 1024))
    expect(chunkFirehoseRecords(large).map((chunk) => chunk.length)).toEqual([4, 1])
    expect(() => chunkFirehoseRecords([new Uint8Array(1_000 * 1024 + 1)])).toThrow(RangeError)
  })

  it('builds PutRecordBatch and reports failed records by index', () => {
    const records = [new Uint8Array([1]), new Uint8Array([2]), new Uint8Array([3])]
    expect(buildPutRecordBatchCommand('stream', records).input).toEqual({
      DeliveryStreamName: 'stream',
      Records: [{ Data: records[0] }, { Data: records[1] }, { Data: records[2] }],
    })
    expect(getFailedFirehoseRecords(records, { FailedPutCount: 0, RequestResponses: [] })).toEqual(
      [],
    )
    expect(
      getFailedFirehoseRecords(records, {
        FailedPutCount: 2,
        RequestResponses: [
          { RecordId: 'a' },
          { ErrorCode: 'X' },
          { ErrorCode: 'Y' },
          { ErrorCode: 'Z' },
        ],
      }),
    ).toEqual([records[1], records[2]])
    expect(
      getFailedFirehoseRecords(records, { FailedPutCount: 1, RequestResponses: undefined }),
    ).toEqual([])
  })
})

describe('errors', () => {
  it('detects throttling by name, code, retryable flag, and status', () => {
    expect(isAwsThrottlingError({ name: 'ThrottlingException' })).toBe(true)
    expect(isAwsThrottlingError({ Code: 'Throttling' })).toBe(true)
    expect(isAwsThrottlingError({ code: 'SlowDown' })).toBe(true)
    expect(isAwsThrottlingError({ name: 'ServiceUnavailableException' })).toBe(true)
    expect(isAwsThrottlingError({ $retryable: { throttling: true } })).toBe(true)
    expect(isAwsThrottlingError({ $metadata: { httpStatusCode: 429 } })).toBe(true)
    expect(isAwsThrottlingError({ name: 'AccessDenied', $metadata: { httpStatusCode: 403 } })).toBe(
      false,
    )
    expect(isAwsThrottlingError({ name: 5 })).toBe(false)
    expect(isAwsThrottlingError(null)).toBe(false)
    expect(isAwsThrottlingError('Throttling')).toBe(false)
  })

  it('reads the HTTP status', () => {
    expect(getAwsErrorStatus({ $metadata: { httpStatusCode: 503 } })).toBe(503)
    expect(getAwsErrorStatus({ $metadata: { httpStatusCode: '503' } })).toBeUndefined()
    expect(getAwsErrorStatus(undefined)).toBeUndefined()
  })
})
