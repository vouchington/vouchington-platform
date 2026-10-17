const THROTTLING_NAMES = new Set([
  'BandwidthLimitExceeded',
  'EC2ThrottledException',
  'LimitExceededException',
  'PriorRequestNotComplete',
  'ProvisionedThroughputExceededException',
  'RequestLimitExceeded',
  'RequestThrottled',
  'RequestThrottledException',
  'ServiceUnavailableException',
  'SlowDown',
  'ThrottledException',
  'Throttling',
  'ThrottlingException',
  'TooManyRequestsException',
])

interface AwsErrorShape {
  name?: unknown
  Code?: unknown
  code?: unknown
  $retryable?: { throttling?: unknown }
  $metadata?: { httpStatusCode?: unknown }
}

function asShape(error: unknown): AwsErrorShape | undefined {
  return typeof error === 'object' && error !== null ? (error as AwsErrorShape) : undefined
}

// Returns the HTTP status from an AWS SDK v3 error. Pass it as `getStatus` to queue-errors helpers.
export function getAwsErrorStatus(error: unknown): number | undefined {
  const status = asShape(error)?.$metadata?.httpStatusCode
  return typeof status === 'number' ? status : undefined
}

// Detects rate-limit style failures across SES, SQS, Firehose, and CloudWatch error shapes.
export function isAwsThrottlingError(error: unknown): boolean {
  const shape = asShape(error)
  if (!shape) return false
  if (shape.$retryable?.throttling === true) return true
  if (getAwsErrorStatus(error) === 429) return true
  return [shape.name, shape.Code, shape.code].some(
    (value) => typeof value === 'string' && THROTTLING_NAMES.has(value),
  )
}
