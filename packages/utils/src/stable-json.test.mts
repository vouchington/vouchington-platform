import { describe, expect, it } from 'vitest'
import { stableJsonStringify } from './stable-json.mts'

describe('stable JSON', () => {
  it('sorts keys, respects toJSON, and normalizes undefined values', () => {
    expect(
      stableJsonStringify({
        z: undefined,
        a: { y: 2, x: 1 },
        array: [undefined, { toJSON: () => ({ b: 2, a: 1 }) }],
      }),
    ).toBe(
      '{\n  "a": {\n    "x": 1,\n    "y": 2\n  },\n  "array": [\n    null,\n    {\n      "a": 1,\n      "b": 2\n    }\n  ]\n}\n',
    )
  })
  it('keeps short scalar arrays inline and wraps long arrays', () => {
    expect(stableJsonStringify([1, 'two', null])).toBe('[1, "two", null]\n')
    expect(stableJsonStringify(Array.from({ length: 60 }, () => 1))).toContain('\n')
    expect(stableJsonStringify(undefined)).toBe('null\n')
    expect(stableJsonStringify([])).toBe('[]\n')
    expect(stableJsonStringify({})).toBe('{}\n')
  })
  it('omits unsupported object values and converts unsupported array values to null', () => {
    const sparse: unknown[] = []
    sparse.length = 1
    expect(stableJsonStringify({ fn() {}, symbol: Symbol('ignored'), value: 1 })).toBe(
      '{\n  "value": 1\n}\n',
    )
    expect(stableJsonStringify([undefined, () => undefined, Symbol('ignored')])).toBe(
      '[null, null, null]\n',
    )
    expect(stableJsonStringify(sparse)).toBe('[null]\n')
    expect(stableJsonStringify(Symbol('root'))).toBe('null\n')
  })
})
