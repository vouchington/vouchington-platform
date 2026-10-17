import { PutMetricDataCommand, type MetricDatum } from '@aws-sdk/client-cloudwatch'
import { chunkBySize } from './chunk.mts'

export const CLOUDWATCH_MAX_METRICS_PER_REQUEST = 1_000
// CloudWatch caps requests at 1 MB; stay under it to leave room for the envelope.
const CLOUDWATCH_MAX_REQUEST_BYTES = 900_000

// Splits metric data into PutMetricData-sized batches by count and approximate serialized size.
// The caller sends each batch. A single datum over the byte limit throws.
export function chunkMetricData(
  metricData: readonly MetricDatum[],
  options: { maxItems?: number; maxBytes?: number } = {},
): MetricDatum[][] {
  return chunkBySize(metricData, {
    maxItems: options.maxItems ?? CLOUDWATCH_MAX_METRICS_PER_REQUEST,
    maxBytes: options.maxBytes ?? CLOUDWATCH_MAX_REQUEST_BYTES,
    sizeOf: (datum) => Buffer.byteLength(JSON.stringify(datum), 'utf8'),
  })
}

export function buildPutMetricDataCommand(
  namespace: string,
  metricData: readonly MetricDatum[],
): PutMetricDataCommand {
  return new PutMetricDataCommand({ Namespace: namespace, MetricData: [...metricData] })
}
