import { describe, expect, it } from 'vitest'

import { isDispatchedToolCall, isNotificationShapedToolCall } from './tool-call-shape.mts'

describe('isDispatchedToolCall', () => {
  it('accepts valid tools/call requests carrying a string or integer id', () => {
    expect(
      isDispatchedToolCall({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'echo', arguments: {} },
      }),
    ).toBe(true)
    expect(
      isDispatchedToolCall({
        jsonrpc: '2.0',
        id: 'req-1',
        method: 'tools/call',
        params: { name: 'echo' },
      }),
    ).toBe(true)
  })

  it('rejects notifications, non-integer ids, other methods, and malformed payloads', () => {
    expect(
      isDispatchedToolCall({
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: 'echo' },
      }),
    ).toBe(false)
    expect(
      isDispatchedToolCall({
        jsonrpc: '2.0',
        id: 1.5,
        method: 'tools/call',
        params: { name: 'echo' },
      }),
    ).toBe(false)
    expect(
      isDispatchedToolCall({
        jsonrpc: '2.0',
        id: null,
        method: 'tools/call',
        params: { name: 'echo' },
      }),
    ).toBe(false)
    expect(isDispatchedToolCall({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).toBe(false)
    expect(isDispatchedToolCall(null)).toBe(false)
  })
})

describe('isNotificationShapedToolCall', () => {
  it('matches tools/call messages with missing or null id', () => {
    expect(isNotificationShapedToolCall({ method: 'tools/call', params: { name: 'echo' } })).toBe(
      true,
    )
    expect(isNotificationShapedToolCall({ method: 'tools/call', id: null })).toBe(true)
  })

  it('rejects identified tool calls, other methods, and non-objects', () => {
    expect(isNotificationShapedToolCall({ method: 'tools/call', id: 1 })).toBe(false)
    expect(isNotificationShapedToolCall({ method: 'tools/call', id: 'req-1' })).toBe(false)
    expect(isNotificationShapedToolCall({ method: 'tools/list' })).toBe(false)
    expect(isNotificationShapedToolCall(null)).toBe(false)
    expect(isNotificationShapedToolCall('tools/call')).toBe(false)
  })
})
