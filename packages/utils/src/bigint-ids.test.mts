import { describe, expect, it } from 'vitest'
import { parsePositivePostgresBigint, parsePositivePostgresBigintParam } from './bigint-ids.mts'

describe('Postgres bigint identifiers', () => {
  it('accepts canonical positive JSON-safe values', () => {
    expect(parsePositivePostgresBigint(42)).toBe('42')
    expect(parsePositivePostgresBigint('9223372036854775807')).toBe('9223372036854775807')
    expect(parsePositivePostgresBigintParam({ id: '4' }, 'id')).toBe('4')
    expect(parsePositivePostgresBigintParam({}, 'id')).toBeUndefined()
    expect(parsePositivePostgresBigintParam({ id: 'invalid' }, 'id')).toBeUndefined()
  })
  it.each([
    0,
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    '0',
    '01',
    '-1',
    '9223372036854775808',
    '9'.repeat(10_000),
    null,
  ])('rejects %j', (value) => expect(parsePositivePostgresBigint(value)).toBeNull())
})
