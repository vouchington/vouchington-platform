import { PutMetricDataCommand, type MetricDatum } from '@aws-sdk/client-cloudwatch'
import { chunkBySize } from './chunk.mts'

export const CLOUDWATCH_MAX_METRICS_PER_REQUEST = 1_000

// Splits metric data into PutMetricData-sized batches. The caller sends each batch.
export function chunkMetricData(
  metricData: readonly MetricDatum[],
  maxItems = CLOUDWATCH_MAX_METRICS_PER_REQUEST,
): MetricDatum[][] {
  return chunkBySize(metricData, { maxItems, maxBytes: Number.MAX_SAFE_INTEGER, sizeOf: () => 0 })
}

export function buildPutMetricDataCommand(
  namespace: string,
  metricData: readonly MetricDatum[],
): PutMetricDataCommand {
  return new PutMetricDataCommand({ Namespace: namespace, MetricData: [...metricData] })
}
