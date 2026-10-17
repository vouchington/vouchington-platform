import {
  APIConnectionError,
  APIConnectionTimeoutError,
  APIError,
  APIUserAbortError,
  RateLimitError,
} from 'openai'
import { describe, expect, it } from 'vitest'
import {
  describeOpenAIUpstreamFailure,
  getOpenAIFlexFallback,
  getOpenAIRetryAfterMs,
  isExplicitClientCancelError,
  isOpenAIFlexCapacityFailedResponseError,
  isOpenAIFlexResourceUnavailableError,
  isOpenAIMissingPreviousResponseError,
  isOpenAINotFoundError,
  isOpenAIRateLimitError,
  isOpenAIServerError,
  OpenAIResponseNotCompletedError,
  OpenAIResponseStreamIterationError,
  shouldLatchUnknownBilledOpenAIAttempt,
  toOpenRouterModel,
  walkErrorChain,
  findInErrorChain,
} from './index.mts'

function apiError(status: number | undefined, body?: object, headers: Record<string, string> = {}) {
  return APIError.generate(status, body ? { error: body } : undefined, 'msg', new Headers(headers))
}
const flexFailed = (usage?: { input_tokens: number; output_tokens: number }) =>
  new OpenAIResponseNotCompletedError('Flex processing is temporarily unavailable.', {
    id: 'r',
    status: 'failed',
    error: { code: 'server_error' },
    ...(usage ? { usage } : {}),
    output: [],
  })

describe('error chain', () => {
  it('walks causes, tolerating cycles and non-objects', () => {
    const a: { cause?: unknown } = {}
    const b = { cause: a }
    a.cause = b
    expect(walkErrorChain(a, () => false)).toBe(false)
    expect(findInErrorChain('str', () => 'x')).toBeNull()
    expect(findInErrorChain(null, () => 'x')).toBeNull()
    expect(
      walkErrorChain(
        new Error('o', { cause: new RangeError('i') }),
        (e) => e instanceof RangeError,
      ),
    ).toBe(true)
    expect(
      findInErrorChain(
        () => 1,
        () => 'fn',
      ),
    ).toBe('fn')
  })
})

describe('classification', () => {
  it('detects rate limit, server and not-found errors', () => {
    expect(isOpenAIRateLimitError(apiError(429))).toBe(true)
    expect(isOpenAIRateLimitError(new RateLimitError(429, undefined, 'x', new Headers()))).toBe(
      true,
    )
    expect(isOpenAIRateLimitError(apiError(400))).toBe(false)
    expect(isOpenAIRateLimitError('x')).toBe(false)
    expect(isOpenAIServerError(apiError(503))).toBe(true)
    expect(isOpenAIServerError(apiError(400))).toBe(false)
    expect(isOpenAIServerError(undefined)).toBe(false)
    expect(isOpenAINotFoundError(apiError(404))).toBe(true)
    expect(isOpenAINotFoundError(new Error('x'))).toBe(false)
  })

  it('detects flex capacity conditions', () => {
    expect(
      isOpenAIFlexResourceUnavailableError(apiError(429, { code: 'resource_unavailable' })),
    ).toBe(true)
    expect(
      isOpenAIFlexResourceUnavailableError(
        new APIError(429, undefined, 'Resource Unavailable', new Headers()),
      ),
    ).toBe(true)
    expect(isOpenAIFlexResourceUnavailableError(apiError(429, { code: 'rate_limit' }))).toBe(false)
    expect(isOpenAIFlexResourceUnavailableError(apiError(500))).toBe(false)
    expect(isOpenAIFlexResourceUnavailableError()).toBe(false)
    expect(isOpenAIFlexCapacityFailedResponseError(flexFailed())).toBe(true)
    expect(
      isOpenAIFlexCapacityFailedResponseError(flexFailed({ input_tokens: 1, output_tokens: 1 })),
    ).toBe(false)
    expect(isOpenAIFlexCapacityFailedResponseError(new Error('x'))).toBe(false)
  })

  it('detects cancels and missing previous responses', () => {
    expect(isExplicitClientCancelError(new APIUserAbortError())).toBe(true)
    const abort = new Error('a')
    abort.name = 'AbortError'
    expect(isExplicitClientCancelError(new Error('w', { cause: abort }))).toBe(true)
    expect(isExplicitClientCancelError(new Error('x'))).toBe(false)
    const missing = { code: 'previous_response_not_found', param: 'previous_response_id' }
    expect(isOpenAIMissingPreviousResponseError(apiError(400, missing))).toBe(true)
    expect(isOpenAIMissingPreviousResponseError(apiError(400, { code: 'other' }))).toBe(false)
  })

  it('decides when an attempt must latch as possibly billed', () => {
    const missing = apiError(400, {
      code: 'previous_response_not_found',
      param: 'previous_response_id',
    })
    expect(shouldLatchUnknownBilledOpenAIAttempt(missing)).toBe(false)
    expect(shouldLatchUnknownBilledOpenAIAttempt(flexFailed())).toBe(false)
    const cancel = new APIUserAbortError()
    expect(shouldLatchUnknownBilledOpenAIAttempt(cancel)).toBe(true)
    expect(shouldLatchUnknownBilledOpenAIAttempt(cancel, { cancelledBeforeDispatch: true })).toBe(
      false,
    )
    expect(
      shouldLatchUnknownBilledOpenAIAttempt(apiError(500), { cancelledBeforeDispatch: true }),
    ).toBe(true)
    const usage = { input_tokens: 1, output_tokens: 1 }
    const withUsage = new OpenAIResponseNotCompletedError('x', {
      status: 'incomplete',
      usage,
      output: [],
    })
    expect(shouldLatchUnknownBilledOpenAIAttempt(withUsage)).toBe(false)
    const noUsage = new OpenAIResponseNotCompletedError('x', { status: 'incomplete', output: [] })
    expect(shouldLatchUnknownBilledOpenAIAttempt(noUsage)).toBe(true)
    expect(shouldLatchUnknownBilledOpenAIAttempt(apiError(500))).toBe(true)
    const flex429 = apiError(429, { code: 'resource_unavailable' })
    expect(shouldLatchUnknownBilledOpenAIAttempt(flex429)).toBe(false)
  })

  it('reads retry-after with a fallback', () => {
    expect(getOpenAIRetryAfterMs(apiError(429, undefined, { 'retry-after': '2' }))).toBe(2000)
    expect(getOpenAIRetryAfterMs(apiError(429))).toBe(60_000)
    expect(getOpenAIRetryAfterMs(apiError(429), 5)).toBe(5)
    expect(getOpenAIRetryAfterMs(new Error('x'))).toBe(60_000)
    expect(getOpenAIRetryAfterMs(new APIError(429, undefined, 'm', undefined))).toBe(60_000)
  })

  it('describes upstream failures narrowly', () => {
    expect(describeOpenAIUpstreamFailure(new APIUserAbortError())).toBeNull()
    expect(describeOpenAIUpstreamFailure(new APIConnectionError({ message: 'x' }))).toMatchObject({
      reason: 'the connection to OpenAI failed',
    })
    expect(describeOpenAIUpstreamFailure(apiError(503, { code: 'x' }))).toMatchObject({
      status: 503,
      code: 'x',
    })
    expect(describeOpenAIUpstreamFailure(apiError(429))).toMatchObject({ status: 429 })
    expect(describeOpenAIUpstreamFailure(apiError(404))).toMatchObject({ status: 404 })
    expect(describeOpenAIUpstreamFailure(apiError(404, { code: 'model_not_found' }))).toBeNull()
    expect(describeOpenAIUpstreamFailure(apiError(401))).toBeNull()
    expect(
      describeOpenAIUpstreamFailure(new APIError(undefined, undefined, 'm', undefined)),
    ).toBeNull()
    expect(describeOpenAIUpstreamFailure(new Error('x'))).toBeNull()
    expect(
      describeOpenAIUpstreamFailure(new OpenAIResponseStreamIterationError(false, { cause: 1 })),
    ).toMatchObject({
      reason: 'the response stream ended before emitting any text',
    })
    expect(
      describeOpenAIUpstreamFailure(new OpenAIResponseStreamIterationError(true, { cause: 1 })),
    ).toBeNull()
    expect(describeOpenAIUpstreamFailure(flexFailed())).toMatchObject({ code: 'server_error' })
    const streamed = new OpenAIResponseNotCompletedError('x', {
      status: 'failed',
      error: { code: 'rate_limit_exceeded' },
      output: [],
    })
    expect(describeOpenAIUpstreamFailure(streamed)).toMatchObject({ code: 'rate_limit_exceeded' })
    const noCode = new OpenAIResponseNotCompletedError('x', { status: 'failed', output: [] })
    expect(describeOpenAIUpstreamFailure(noCode)).toBeNull()
    expect(describeOpenAIUpstreamFailure(new APIConnectionTimeoutError())).toBeNull()
    const partial = new OpenAIResponseStreamIterationError(true, {
      cause: new APIConnectionError({ message: 'x' }),
    })
    expect(describeOpenAIUpstreamFailure(partial)).toBeNull()
    expect(describeOpenAIUpstreamFailure(apiError(429, { code: 'insufficient_quota' }))).toBeNull()
    expect(
      describeOpenAIUpstreamFailure(apiError(429, { code: 'rate_limit_exceeded' })),
    ).toMatchObject({
      status: 429,
    })
    const other = new OpenAIResponseNotCompletedError('x', {
      status: 'failed',
      error: { code: 'invalid_prompt' },
      output: [],
    })
    expect(describeOpenAIUpstreamFailure(other)).toBeNull()
  })
})

describe('flex fallback', () => {
  const params = { model: 'm', service_tier: 'flex' }

  it('builds default-tier resend params for the unbilled flex conditions', () => {
    expect(getOpenAIFlexFallback(params, apiError(429, { code: 'resource_unavailable' }))).toEqual({
      params: { model: 'm', service_tier: 'default' },
      trigger: 'http_429',
    })
    expect(getOpenAIFlexFallback(params, flexFailed())?.trigger).toBe('stream_failed')
  })

  it('declines other errors and non-flex requests', () => {
    expect(getOpenAIFlexFallback(params, apiError(500))).toBeNull()
    expect(getOpenAIFlexFallback({ service_tier: 'default' }, flexFailed())).toBeNull()
    expect(getOpenAIFlexFallback({}, flexFailed())).toBeNull()
  })

  it('prefixes bare model names for OpenRouter', () => {
    expect(toOpenRouterModel('gpt-x')).toBe('openai/gpt-x')
    expect(toOpenRouterModel('vendor/model')).toBe('vendor/model')
  })
})
