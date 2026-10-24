import { ErrorCode } from '@modelcontextprotocol/sdk/types.js'
import { describe, expect, it } from 'vitest'

import { validateToolsRequest } from './validate-request.mts'

describe('validateToolsRequest', () => {
  it.each([
    ['a valid tools/list', { jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} }],
    ['a valid tools/call', { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'x' } }],
    ['another method', { jsonrpc: '2.0', id: 1, method: 'ping' }],
    ['a batch', [{ jsonrpc: '2.0', id: 1, method: 'tools/call', params: {} }]],
    ['a scalar', 'text'],
    ['null', null],
  ])('passes %s on to the transport', (_name, body) => {
    expect(validateToolsRequest(body)).toBeNull()
  })

  it.each([
    ['a string id', 'abc'],
    ['a numeric id', 7],
    ['a missing id', undefined],
    ['an unusable id', { nested: true }],
  ])('answers an invalid tools/call with %s as a JSON-RPC error', async (_name, id) => {
    const response = validateToolsRequest({ jsonrpc: '2.0', id, method: 'tools/call', params: {} })

    expect(response?.status).toBe(200)
    expect(await response?.json()).toEqual({
      jsonrpc: '2.0',
      id: typeof id === 'string' || typeof id === 'number' ? id : null,
      error: { code: ErrorCode.InvalidRequest, message: 'Invalid request' },
    })
  })

  it('answers an invalid tools/list too', async () => {
    const response = validateToolsRequest({
      jsonrpc: '2.0',
      id: 1,
      method: 'tools/list',
      params: 3,
    })

    expect(await response?.json()).toMatchObject({
      id: 1,
      error: { code: ErrorCode.InvalidRequest },
    })
  })
})
