import type { NodeHttpHandler } from '@smithy/node-http-handler'
import { describe, expect, it } from 'vitest'
import {
  AWS_CONNECTION_TIMEOUT_MS,
  AWS_DUALSTACK_CLIENT_CONFIG,
  AWS_LONG_POLL_SOCKET_TIMEOUT_MS,
  AWS_SOCKET_TIMEOUT_MS,
  createAwsRequestHandler,
} from './request-handler.mts'

// The handler resolves its options lazily; read them the way the SDK would on first request.
function resolvedConfig(handler: NodeHttpHandler) {
  return (handler as unknown as { configProvider: Promise<object> }).configProvider
}

describe('createAwsRequestHandler', () => {
  it('exposes timeout constants', () => {
    expect(AWS_CONNECTION_TIMEOUT_MS).toBe(3_000)
    expect(AWS_SOCKET_TIMEOUT_MS).toBe(10_000)
    expect(AWS_LONG_POLL_SOCKET_TIMEOUT_MS).toBeGreaterThan(20_000)
    expect(AWS_DUALSTACK_CLIENT_CONFIG).toEqual({ useDualstackEndpoint: true })
  })

  it('applies default deadlines and accepts overrides', async () => {
    expect(await resolvedConfig(createAwsRequestHandler())).toMatchObject({
      connectionTimeout: AWS_CONNECTION_TIMEOUT_MS,
      socketTimeout: AWS_SOCKET_TIMEOUT_MS,
    })
    const custom = createAwsRequestHandler({ socketTimeout: AWS_LONG_POLL_SOCKET_TIMEOUT_MS })
    expect(await resolvedConfig(custom)).toMatchObject({
      socketTimeout: AWS_LONG_POLL_SOCKET_TIMEOUT_MS,
    })
  })
})
