import { NodeHttpHandler, type NodeHttpHandlerOptions } from '@smithy/node-http-handler'
import type { IncomingMessage } from 'node:http'

export const AWS_CONNECTION_TIMEOUT_MS = 3_000
export const AWS_SOCKET_TIMEOUT_MS = 10_000
// SQS receives wait up to 20 seconds by protocol; keep the transport idle deadline above that.
export const AWS_LONG_POLL_SOCKET_TIMEOUT_MS = 25_000

// Opt supported clients into dual-stack endpoints explicitly instead of AWS_USE_DUALSTACK_ENDPOINT.
export const AWS_DUALSTACK_CLIENT_CONFIG = { useDualstackEndpoint: true } as const

class AwsNodeHttpHandler extends NodeHttpHandler {
  readonly #socketTimeout: number

  constructor(options: NodeHttpHandlerOptions) {
    super(options)
    this.#socketTimeout = options.socketTimeout ?? 0
  }

  override async handle(...args: Parameters<NodeHttpHandler['handle']>) {
    const output = await super.handle(...args)
    if (this.#socketTimeout > 0 && isIncomingMessage(output.response.body)) {
      armResponseBodyTimeout(output.response.body, this.#socketTimeout)
    }
    return output
  }
}

class AwsResponseBodyTimeoutError extends Error {
  override readonly name = 'TimeoutError'
  readonly code = 'ETIMEDOUT'
}

function isIncomingMessage(body: unknown): body is IncomingMessage {
  return typeof body === 'object' && body !== null && 'setTimeout' in body && 'socket' in body
}

function armResponseBodyTimeout(body: IncomingMessage, timeoutMs: number): void {
  const socket = body.socket
  const timeoutError = new AwsResponseBodyTimeoutError(
    `AWS response body was inactive for ${timeoutMs} ms`,
  )
  const onTimeout = () => body.destroy(timeoutError)
  let cleared = false
  const clear = () => {
    if (cleared) return
    cleared = true
    socket.removeListener('timeout', onTimeout)
    if (!socket.destroyed) socket.setTimeout(0)
  }
  body.setTimeout(timeoutMs, onTimeout)
  body.once('end', clear)
  body.once('close', clear)
}

// Node HTTP handler with connection and socket deadlines that also cover the response body.
export function createAwsRequestHandler(overrides: NodeHttpHandlerOptions = {}): NodeHttpHandler {
  return new AwsNodeHttpHandler({
    connectionTimeout: AWS_CONNECTION_TIMEOUT_MS,
    socketTimeout: AWS_SOCKET_TIMEOUT_MS,
    ...overrides,
  })
}
