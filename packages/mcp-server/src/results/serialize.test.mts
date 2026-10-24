import { describe, expect, it } from 'vitest'

import { McpToolResultTooLargeError } from './errors.mts'
import {
  MAX_MCP_TOOL_RESULT_BYTES,
  MAX_MCP_TOOL_RESULT_VISITS,
  serializeMcpToolResult,
} from './serialize.mts'

describe('serializeMcpToolResult', () => {
  it('matches JSON.stringify for plain values', () => {
    const value = {
      text: 'a "quoted" line\n',
      count: 3,
      ratio: 0.5,
      flags: [true, false, null],
      nested: { list: [{ id: 1 }, { id: 2 }], empty: {}, none: [] },
      unicode: ' é😀',
    }

    expect(serializeMcpToolResult(value)).toBe(JSON.stringify(value))
    for (const primitive of ['text', 7, true, false, null])
      expect(serializeMcpToolResult(primitive)).toBe(JSON.stringify(primitive))
  })

  it('writes non-finite numbers as null', () => {
    expect(serializeMcpToolResult([Number.NaN, Infinity, -Infinity])).toBe('[null,null,null]')
  })

  it('honors toJSON, passing the key, and serializes dates as ISO strings', () => {
    const keys: string[] = []
    const value = {
      when: new Date('2026-01-02T03:04:05.000Z'),
      custom: { toJSON: (key: string) => (keys.push(key), { seen: key }) },
      list: [{ toJSON: (key: string) => (keys.push(key), key) }],
      broken: { toJSON: 'not a function', kept: 1 },
    }

    const expected = JSON.stringify(value)
    keys.length = 0

    expect(serializeMcpToolResult(value)).toBe(expected)
    expect(keys).toEqual(['custom', '0'])
  })

  it('omits undefined, function and symbol properties, and nulls them in arrays', () => {
    const value = { a: undefined, b: () => 1, c: Symbol('x'), d: 1, list: [undefined, () => 1, 2] }

    expect(serializeMcpToolResult(value)).toBe(JSON.stringify(value))
    expect(serializeMcpToolResult({ only: undefined })).toBe('{}')
    expect(serializeMcpToolResult({ x: undefined, y: 1 })).toBe('{"y":1}')
    expect(serializeMcpToolResult({ y: 1, x: undefined })).toBe('{"y":1}')
  })

  it('rejects a result that has no JSON form', () => {
    for (const value of [undefined, () => 1, Symbol('x')])
      expect(() => serializeMcpToolResult(value)).toThrow('Tool result is not JSON serializable')
  })

  it('refuses cycles, but allows a shared object that is not an ancestor', () => {
    const cyclic: Record<string, unknown> = { name: 'loop' }
    cyclic['self'] = cyclic
    const shared = { id: 1 }

    expect(() => serializeMcpToolResult(cyclic)).toThrow(TypeError)
    expect(() => serializeMcpToolResult([cyclic])).toThrow('circular')
    expect(serializeMcpToolResult({ a: shared, b: [shared] })).toBe('{"a":{"id":1},"b":[{"id":1}]}')
  })

  it('unboxes Boolean, Number and String objects the way JSON.stringify does', () => {
    const value = {
      yes: new Boolean(false),
      n: new Number(3),
      s: new String('a"b'),
      list: [new Number(1)],
    }

    expect(serializeMcpToolResult(value)).toBe(JSON.stringify(value))
    expect(serializeMcpToolResult(value)).toBe('{"yes":false,"n":3,"s":"a\\"b","list":[1]}')
    expect(() => serializeMcpToolResult({ n: Object(1n) })).toThrow('BigInt')
  })

  it('refuses a BigInt the way JSON.stringify does', () => {
    expect(() => serializeMcpToolResult({ n: 1n })).toThrow('BigInt')
  })

  it('skips inherited properties', () => {
    const value = Object.assign(Object.create({ inherited: 1 }) as object, { own: 2 })

    expect(serializeMcpToolResult(value)).toBe('{"own":2}')
  })

  it('stops at the byte bound, including a bound set by the caller', () => {
    const filler = 'x'.repeat(1000)

    expect(() => serializeMcpToolResult(filler, 500)).toThrow(McpToolResultTooLargeError)
    expect(() => serializeMcpToolResult({ list: [filler, filler] }, 1500)).toThrow('response limit')
    expect(serializeMcpToolResult({ list: [filler] }, 1500)).toContain(filler)
    expect(() =>
      serializeMcpToolResult(filler.repeat(MAX_MCP_TOOL_RESULT_BYTES / 1000 + 1)),
    ).toThrow(McpToolResultTooLargeError)
  })

  it('refuses an oversized key before writing it', () => {
    const key = 'k'.repeat(600)

    expect(() => serializeMcpToolResult({ [key]: 1 }, 500)).toThrow(McpToolResultTooLargeError)
  })

  it('stops at the visit bound whatever the byte bound', () => {
    const wide = Array.from({ length: MAX_MCP_TOOL_RESULT_VISITS + 1 }, () => 0)
    const keyed = Object.fromEntries(wide.map((_, index) => [`k${index}`, 0]))

    expect(() => serializeMcpToolResult(wide)).toThrow('traversal limit')
    expect(() => serializeMcpToolResult(keyed)).toThrow('traversal limit')
    expect(serializeMcpToolResult(wide.slice(0, 1000))).toHaveLength(2001)
  })
})
