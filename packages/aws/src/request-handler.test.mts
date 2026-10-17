import { EventEmitter } from 'node:events'
import { NodeHttpHandler } from '@smithy/node-http-handler'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  AWS_CONNECTION_TIMEOUT_MS,
  AWS_DUALSTACK_CLIENT_CONFIG,
  AWS_LONG_POLL_SOCKET_TIMEOUT_MS,
  AWS_SOCKET_TIMEOUT_MS,
  createAwsRequestHandler,
} from './request-handler.mts'

class FakeSocket extends EventEmitter {
  destroyed = false
  setTimeout = vi.fn()
}

class FakeBody extends EventEmitter {
  socket = new FakeSocket()
  destroy = vi.fn()
  setTimeout = vi.fn((_ms: number, listener: () => void) => {
    this.socket.on('timeout', listener)
  })
}

function stubHandle(body: unknown) {
  return vi
    .spyOn(NodeHttpHandler.prototype, 'handle')
    .mockResolvedValue({ response: { body } } as never)
}

afterEach(() => vi.restoreAllMocks())

describe('createAwsRequestHandler', () => {
  it('exposes timeout constants', () => {
    expect(AWS_CONNECTION_TIMEOUT_MS).toBe(3_000)
    expect(AWS_SOCKET_TIMEOUT_MS).toBe(10_000)
    expect(AWS_LONG_POLL_SOCKET_TIMEOUT_MS).toBeGreaterThan(20_000)
    expect(AWS_DUALSTACK_CLIENT_CONFIG).toEqual({ useDualstackEndpoint: true })
  })

  it('arms an inactivity timeout that destroys the body, then clears once', async () => {
    const body = new FakeBody()
    stubHandle(body)
    await createAwsRequestHandler().handle({} as never)
    expect(body.setTimeout).toHaveBeenCalledWith(AWS_SOCKET_TIMEOUT_MS, expect.any(Function))
    body.socket.emit('timeout')
    expect(body.destroy).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'TimeoutError', code: 'ETIMEDOUT' }),
    )
    body.emit('end')
    body.emit('close')
    expect(body.socket.setTimeout).toHaveBeenCalledTimes(1)
    expect(body.socket.setTimeout).toHaveBeenCalledWith(0)
    expect(body.socket.listenerCount('timeout')).toBe(0)
  })

  it('does not reset an already destroyed socket', async () => {
    const body = new FakeBody()
    body.socket.destroyed = true
    stubHandle(body)
    await createAwsRequestHandler({ socketTimeout: 5 }).handle({} as never)
    body.emit('close')
    expect(body.socket.setTimeout).not.toHaveBeenCalled()
  })

  it('skips non-stream bodies and disabled timeouts', async () => {
    const body = new FakeBody()
    stubHandle('text')
    await createAwsRequestHandler().handle({} as never)
    stubHandle(null)
    await createAwsRequestHandler().handle({} as never)
    stubHandle(body)
    await createAwsRequestHandler({ socketTimeout: 0 }).handle({} as never)
    await createAwsRequestHandler({ socketTimeout: undefined } as never).handle({} as never)
    expect(body.setTimeout).not.toHaveBeenCalled()
  })
})
