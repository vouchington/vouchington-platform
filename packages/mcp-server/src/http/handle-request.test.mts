import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import {
  ErrorCode,
  LATEST_PROTOCOL_VERSION,
  type CallToolResult,
} from '@modelcontextprotocol/sdk/types.js'
import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  handleStatelessMcpRequest,
  type StatelessMcpHooks,
  type StatelessMcpRequest,
} from './handle-request.mts'

type Overrides = Partial<StatelessMcpRequest>
const ok = (text: string): CallToolResult => ({ content: [{ type: 'text', text }] })
const call = (id: string | number | undefined, name = 'read', args?: unknown) => ({
  jsonrpc: '2.0',
  ...(id === undefined ? {} : { id }),
  method: 'tools/call',
  params: { name, ...(args === undefined ? {} : { arguments: args }) },
})
const isDispatched = (message: unknown): message is { id: string | number } =>
  typeof message === 'object' &&
  message !== null &&
  (message as { method?: unknown }).method === 'tools/call' &&
  'id' in message

function post(body: unknown, overrides: Overrides = {}): Promise<Response> {
  return handleStatelessMcpRequest({
    serverInfo: { name: 'example-server', version: '2.0.0' },
    request: new Request('http://localhost/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify(body),
    }),
    parsedBody: body,
    listTools: () => [],
    callTool: (request) => Promise.resolve(ok(`ran ${request.name}`)),
    isDispatchedToolCall: isDispatched,
    rateLimitedCalls: new Map(),
    buildRateLimitedResult: (retryAfter) => ({
      isError: true,
      content: [{ type: 'text', text: `limited ${retryAfter}` }],
    }),
    ...overrides,
  })
}
const json = async (response: Promise<Response>) => (await response).json() as Promise<any>
const texts = (result: { content: Array<{ text: string }> }) => result.content.map((c) => c.text)

afterEach(() => vi.restoreAllMocks())

describe('handleStatelessMcpRequest', () => {
  it('answers initialize with the server info and the injected instructions', async () => {
    const body = {
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' },
      },
    }

    const withText = await json(post(body, { instructions: 'Be careful.' }))
    const without = await json(post(body))

    expect(withText.result).toMatchObject({
      serverInfo: { name: 'example-server', version: '2.0.0' },
      instructions: 'Be careful.',
      capabilities: { tools: {} },
    })
    expect(without.result).not.toHaveProperty('instructions')
  })

  it('lists tools from a synchronous or asynchronous source', async () => {
    const tool = { name: 'read', inputSchema: { type: 'object' as const } }
    const list = { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }

    expect((await json(post(list, { listTools: () => [tool] }))).result.tools).toEqual([tool])
    expect(
      (await json(post(list, { listTools: () => Promise.resolve([tool]) }))).result.tools,
    ).toEqual([tool])
  })

  it('passes the call to the injected tool and returns its result', async () => {
    const callTool = vi.fn((_request: unknown) => Promise.resolve(ok('done')))

    const reply = await json(post(call(1, 'read', { id: 'a' }), { callTool }))
    await post(call(2, 'bare'), { callTool })

    expect(reply.result).toEqual(ok('done'))
    expect(callTool.mock.calls[0]![0]).toEqual({ name: 'read', arguments: { id: 'a' } })
    expect(callTool.mock.calls[1]![0]).toEqual({ name: 'bare', arguments: {} })
  })

  it('short-circuits an invalid tools request before any tool runs', async () => {
    const callTool = vi.fn()
    const reply = await json(
      post(
        { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { arguments: {} } },
        { callTool },
      ),
    )

    expect(reply.error.code).toBe(ErrorCode.InvalidRequest)
    expect(callTool).not.toHaveBeenCalled()
  })

  it('lets the caller replace request validation', async () => {
    const refusal = Response.json({ refused: true }, { status: 418 })
    const response = await post(call(1), { validateRequest: () => refusal })

    expect(response.status).toBe(418)
    expect((await post(call(1), { validateRequest: () => null })).status).toBe(200)
  })

  it.each(['GET', 'DELETE', 'PUT'])('refuses %s with 405 and Allow: POST', async (method) => {
    const callTool = vi.fn()
    const response = await handleStatelessMcpRequest({
      serverInfo: { name: 'example-server', version: '2.0.0' },
      request: new Request('http://localhost/mcp', { method }),
      parsedBody: undefined,
      listTools: () => [],
      callTool,
      isDispatchedToolCall: isDispatched,
      rateLimitedCalls: new Map(),
      buildRateLimitedResult: () => ({ content: [] }),
    })

    expect(response.status).toBe(405)
    expect(response.headers.get('Allow')).toBe('POST')
    expect(response.body).toBeNull()
    expect(callTool).not.toHaveBeenCalled()
  })

  it('acknowledges a notification with an empty 202', async () => {
    const response = await post({ jsonrpc: '2.0', method: 'notifications/initialized' })

    expect(response.status).toBe(202)
    expect(response.body).toBeNull()
    expect(response.headers.has('Content-Type')).toBe(false)
  })

  it('returns a 202 when the transport has no response to give', async () => {
    vi.spyOn(
      WebStandardStreamableHTTPServerTransport.prototype,
      'handleRequest',
    ).mockResolvedValueOnce(undefined as never)

    expect((await post(call(1))).status).toBe(202)
  })

  describe('rate limiting and hooks', () => {
    const hooks = () => ({
      onToolError: vi.fn<NonNullable<StatelessMcpHooks['onToolError']>>(() => Promise.resolve()),
      onToolRateLimited: vi.fn<NonNullable<StatelessMcpHooks['onToolRateLimited']>>(() =>
        Promise.resolve(),
      ),
      onToolCallSettled: vi.fn<NonNullable<StatelessMcpHooks['onToolCallSettled']>>(),
    })

    it('refuses a spent call in-band, without running it, and settles it as rate limited', async () => {
      const spy = hooks()
      const callTool = vi.fn()

      const reply = await json(
        post(call(1), { callTool, hooks: spy, rateLimitedCalls: new Map([[0, 30]]) }),
      )

      expect(texts(reply.result)).toEqual(['limited 30'])
      expect(callTool).not.toHaveBeenCalled()
      expect(spy.onToolCallSettled).toHaveBeenCalledExactlyOnceWith(0, {
        durationMs: null,
        toolError: false,
        rateLimited: true,
      })
      expect(spy.onToolError).not.toHaveBeenCalled()
    })

    it('indexes calls by message position, so duplicate ids in a batch stay distinct', async () => {
      const spy = hooks()
      const callTool = vi.fn((request: { name: string }) =>
        Promise.resolve(ok(`ran ${request.name}`)),
      )

      await post([call('same', 'first'), call('same', 'second')], {
        callTool,
        hooks: spy,
        rateLimitedCalls: new Map([[0, 5]]),
      })

      expect(callTool).toHaveBeenCalledExactlyOnceWith(
        { name: 'second', arguments: {} },
        expect.anything(),
      )
      expect(spy.onToolCallSettled.mock.calls.map(([index, s]) => [index, s.rateLimited])).toEqual([
        [0, true],
        [1, false],
      ])
    })

    it('answers every call of a batch that reuses an id, under the original id', async () => {
      const callTool = vi.fn((request: { name: string }) =>
        Promise.resolve(ok(`ran ${request.name}`)),
      )

      const replies = await json(
        post([call('same', 'first'), call('same', 'second'), call(9, 'third')], { callTool }),
      )

      expect(callTool).toHaveBeenCalledTimes(3)
      expect(replies.map((reply: { id: unknown }) => reply.id).toSorted()).toEqual([
        9,
        'same',
        'same',
      ])
      expect(replies.map((reply: { result: never }) => texts(reply.result)[0]).toSorted()).toEqual([
        'ran first',
        'ran second',
        'ran third',
      ])
    })

    it('settles a call once even when onToolError rejects or the settle hook throws', async () => {
      const failing = hooks()
      failing.onToolError.mockRejectedValue(new Error('audit down'))
      const callTool = vi.fn(() => Promise.resolve({ isError: true, content: [] }))

      const reply = await json(post(call(1), { callTool, hooks: failing }))

      expect(reply.error).toBeDefined()
      expect(failing.onToolCallSettled).toHaveBeenCalledOnce()
      expect(failing.onToolCallSettled.mock.calls[0]![1].toolError).toBe(true)
      const throwing = hooks()
      throwing.onToolCallSettled.mockImplementation(() => {
        throw new Error('meter down')
      })

      await post(call(1), { callTool: () => Promise.resolve(ok('x')), hooks: throwing })

      expect(throwing.onToolCallSettled).toHaveBeenCalledOnce()
    })

    it('records a tool error once, with the audit option', async () => {
      const spy = hooks()
      const callTool = vi.fn(() => Promise.resolve({ isError: true, content: [] }))
      const resolveAuditOption = vi.fn(() => 'list')

      await post(call(7, 'read', { a: 1 }), { callTool, hooks: spy, resolveAuditOption })

      expect(resolveAuditOption).toHaveBeenCalledWith({ name: 'read', arguments: { a: 1 } })
      expect(spy.onToolError).toHaveBeenCalledExactlyOnceWith('read', 'list')
      expect(spy.onToolCallSettled).toHaveBeenCalledWith(0, {
        durationMs: null,
        toolError: true,
        rateLimited: false,
      })
    })

    it('reports a rate limit found while running, and not as a tool error', async () => {
      const spy = hooks()
      const callTool: StatelessMcpRequest['callTool'] = async (_request, controls) => {
        controls.onInvoked(12)
        await controls.onRateLimited()
        return { isError: true, content: [] }
      }

      await post(call(1), { callTool, hooks: spy, resolveAuditOption: () => 'get' })

      expect(spy.onToolRateLimited).toHaveBeenCalledExactlyOnceWith('read', 0, 'get')
      expect(spy.onToolError).not.toHaveBeenCalled()
      expect(spy.onToolCallSettled).toHaveBeenCalledWith(0, {
        durationMs: 12,
        toolError: false,
        rateLimited: true,
      })
    })

    it('settles a call that throws, then lets the SDK report the failure', async () => {
      const spy = hooks()
      const callTool: StatelessMcpRequest['callTool'] = async (_request, controls) => {
        controls.onInvoked(3)
        throw new Error('boom')
      }

      const reply = await json(post(call(1), { callTool, hooks: spy }))

      expect(reply.error).toMatchObject({ message: expect.stringContaining('boom') })
      expect(spy.onToolCallSettled).toHaveBeenCalledWith(0, {
        durationMs: 3,
        toolError: false,
        rateLimited: false,
      })
      expect(spy.onToolError).not.toHaveBeenCalled()
    })

    it('keeps the tool result when the settle hook throws', async () => {
      const throwing = hooks()
      throwing.onToolCallSettled.mockImplementation(() => {
        throw new Error('meter down')
      })

      const ok200 = await json(post(call(1), { hooks: throwing }))
      const failing = await json(
        post(call(2), { hooks: throwing, callTool: () => Promise.reject(new Error('tool broke')) }),
      )

      expect(texts(ok200.result)).toEqual(['ran read'])
      expect(failing.error.message).toContain('tool broke')
      expect(throwing.onToolCallSettled).toHaveBeenCalledTimes(2)
    })

    it('works without hooks or an audit option resolver', async () => {
      const callTool: StatelessMcpRequest['callTool'] = async (_request, controls) => {
        await controls.onRateLimited()
        return { isError: true, content: [] }
      }

      expect((await json(post(call(1), { callTool }))).result.isError).toBe(true)
      expect(
        (await json(post(call(1), { rateLimitedCalls: new Map([[0, 1]]) }))).result.isError,
      ).toBe(true)
    })

    it('ignores hooks for a call it never indexed', async () => {
      const spy = hooks()
      const callTool: StatelessMcpRequest['callTool'] = async (_request, controls) => {
        await controls.onRateLimited()
        return ok('x')
      }

      await post(call(1), { callTool, hooks: spy, isDispatchedToolCall: isUnindexed })

      expect(spy.onToolRateLimited).not.toHaveBeenCalled()
      expect(spy.onToolCallSettled).not.toHaveBeenCalled()
    })
  })

  describe('lifecycle', () => {
    it('waits for every started call before it returns', async () => {
      const finished: string[] = []
      const callTool: StatelessMcpRequest['callTool'] = async (request) => {
        await new Promise((resolve) => setTimeout(resolve, request.name === 'slow' ? 40 : 0))
        finished.push(request.name)
        return ok(request.name)
      }

      await post([call('dup', 'slow'), call('dup', 'fast')], { callTool })

      expect(finished.toSorted()).toEqual(['fast', 'slow'])
    })

    it('closes the transport and the server when the transport throws', async () => {
      const transportClose = vi.spyOn(WebStandardStreamableHTTPServerTransport.prototype, 'close')
      const serverClose = vi.spyOn(Server.prototype, 'close')
      vi.spyOn(
        WebStandardStreamableHTTPServerTransport.prototype,
        'handleRequest',
      ).mockRejectedValueOnce(new Error('transport failed'))

      await expect(post(call(1))).rejects.toThrow('transport failed')

      expect(transportClose).toHaveBeenCalledOnce()
      expect(serverClose).toHaveBeenCalledOnce()
    })

    it('closes both after a normal request too', async () => {
      const transportClose = vi.spyOn(WebStandardStreamableHTTPServerTransport.prototype, 'close')
      const serverClose = vi.spyOn(Server.prototype, 'close')

      await post(call(1))

      expect(transportClose).toHaveBeenCalledOnce()
      expect(serverClose).toHaveBeenCalledOnce()
    })
  })
})

function isUnindexed(_message: unknown): _message is { id: string | number } {
  return false
}
