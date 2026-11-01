import { NodeHttpHandler, type NodeHttpHandlerOptions } from '@smithy/node-http-handler'

export const AWS_CONNECTION_TIMEOUT_MS = 3_000
export const AWS_SOCKET_TIMEOUT_MS = 10_000
// SQS receives wait up to 20 seconds by protocol; keep the transport idle deadline above that.
export const AWS_LONG_POLL_SOCKET_TIMEOUT_MS = 25_000

export { AWS_DUALSTACK_CLIENT_CONFIG } from './dualstack.mts'

// Node HTTP handler configured with default connection and socket deadlines. Response-body
// lifecycle handling beyond the SDK's own timeouts belongs in the application.
export function createAwsRequestHandler(overrides: NodeHttpHandlerOptions = {}): NodeHttpHandler {
  return new NodeHttpHandler({
    connectionTimeout: AWS_CONNECTION_TIMEOUT_MS,
    socketTimeout: AWS_SOCKET_TIMEOUT_MS,
    ...overrides,
  })
}
