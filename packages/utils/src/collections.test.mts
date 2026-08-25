import { describe, expect, it } from 'vitest'
import {
  dedupeBy,
  dedupeByLast,
  dedupeById,
  mergePageResultsById,
  mergeRecords,
} from './collections.mts'

describe('collections', () => {
  it('deduplicates in first and last occurrence order', () => {
    const values = [
      { id: 'a', value: 1 },
      { id: 'b', value: 2 },
      { id: 'a', value: 3 },
    ]
    expect(dedupeBy(values, (value) => value.id)).toEqual([values[0], values[1]])
    expect(dedupeByLast(values, (value) => value.id)).toEqual([values[2], values[1]])
    expect(dedupeById(values)).toEqual([values[0], values[1]])
  })

  it('merges optional paginated results and records without overwriting early pages', () => {
    expect(
      mergePageResultsById([
        { results: [{ id: 'a' }] },
        null,
        { results: [{ id: 'a' }, { id: 'b' }] },
      ]),
    ).toEqual([{ id: 'a' }, { id: 'b' }])
    expect(mergePageResultsById()).toEqual([])
    expect(mergeRecords([{ a: 1 }, { a: 2, b: 3 }], (page) => page)).toEqual({ a: 1, b: 3 })
  })

  it('merges __proto__ as an own property without changing the result prototype', () => {
    const record = JSON.parse('{"__proto__":{"polluted":true}}') as Record<string, unknown>
    const merged = mergeRecords([record], (page) => page)
    expect(Object.getPrototypeOf(merged)).toBe(Object.prototype)
    expect(Object.hasOwn(merged, '__proto__')).toBe(true)
    expect((merged as { polluted?: boolean }).polluted).toBeUndefined()
  })
})
