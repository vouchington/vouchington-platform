import { describe, expect, it } from 'vitest'
import { parseTableConflicts, serializeTableConflicts, tableKey } from './table-conflict.mts'

describe('catalog table conflict text', () => {
  it('serializes and parses rows plus a deletion conflict', () => {
    const text = serializeTableConflicts(
      [{ id: 'copy.b' }],
      [{ key: tableKey({ id: 'copy.a' }), ours: undefined, theirs: { id: 'copy.a' } }],
    )
    expect(text).toContain('copy.b')
    expect(parseTableConflicts(text)).toEqual({
      rows: [{ id: 'copy.b' }],
      conflicts: [{ key: tableKey({ id: 'copy.a' }), ours: undefined, theirs: { id: 'copy.a' } }],
    })
  })

  it('rejects malformed conflict tables', () => {
    expect(() => parseTableConflicts('{}')).toThrow(/outer array/)
    expect(() => parseTableConflicts('[\n{}')).toThrow(/outer array/)
    expect(() => parseTableConflicts('[\n[]\n]')).toThrow(/rows must be JSON objects/)
    expect(() => parseTableConflicts('[\n<<<<<<< ours\n=======\n>>>>>>> theirs\n]')).toThrow(
      /has no row/,
    )
    expect(() => parseTableConflicts('[\n<<<<<<< ours\n]')).toThrow(/missing =======/)
    expect(() =>
      parseTableConflicts('[\n<<<<<<< ours\n{"id":"copy.a"}\nnot-a-separator\n]'),
    ).toThrow(/missing =======/)
  })
})
