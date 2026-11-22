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

// SES reports a sending-rate throttle as HTTP 400, sometimes with only this message to identify it.
const SES_SENDING_RATE_EXCEEDED = /maximum sending rate exceeded/i

interface AwsErrorShape {
  name?: unknown
  Code?: unknown
  code?: unknown
  message?: unknown
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
// Returns a boolean, not a type guard: every Error fits the optional fields it checks, so a guard
// would narrow a non-throttling Error to `never`.
export function isAwsThrottlingError(error: unknown): boolean {
  const shape = asShape(error)
  if (!shape) return false
  if (shape.$retryable?.throttling === true) return true
  if (getAwsErrorStatus(error) === 429) return true
  if (typeof shape.message === 'string' && SES_SENDING_RATE_EXCEEDED.test(shape.message))
    return true
  return [shape.name, shape.Code, shape.code].some(
    (value) => typeof value === 'string' && THROTTLING_NAMES.has(value),
  )
}
