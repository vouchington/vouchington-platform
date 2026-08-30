import { describe, expect, it } from 'vitest'

import {
  AliasClaimedError,
  InvalidAliasError,
  InvalidEntityMergeError,
  normalizeAlias,
  planAliasClaim,
  planAliasMerge,
} from './index.mts'

describe('alias rules', () => {
  it('normalizes aliases and supports stricter application normalization', () => {
    expect(normalizeAlias('  TWO Words  ')).toBe('two words')
    expect(() => normalizeAlias('')).toThrow(new InvalidAliasError(''))
    expect(() => normalizeAlias('topic', () => '')).toThrow(new InvalidAliasError('topic'))
    expect(normalizeAlias('#topic', (value) => (/^#[a-z]+$/.test(value) ? value : null))).toBe(
      '#topic',
    )
  })

  it('plans unclaimed aliases and preserves an existing claim by the same entity', () => {
    expect(planAliasClaim({ entityId: 'one', ownerId: null, value: ' Alpha ' })).toEqual({
      alias: 'alpha',
      write: true,
    })
    expect(planAliasClaim({ entityId: 'one', ownerId: 'one', value: ' Alpha ' })).toEqual({
      alias: 'alpha',
      write: false,
    })
  })

  it('rejects a foreign alias owner', () => {
    expect(() => planAliasClaim({ entityId: 'one', ownerId: 'two', value: 'alpha' })).toThrow(
      new AliasClaimedError('alpha', 'two'),
    )
  })

  it('includes the source slug in a normalized, sorted, deduplicated merge plan', () => {
    expect(
      planAliasMerge({
        destinationId: 'two',
        owners: [
          { alias: 'first', entityId: 'one' },
          { alias: 'zeta', entityId: 'two' },
        ],
        sourceAliases: ['FIRST', 'zeta'],
        sourceId: 'one',
        sourceSlug: ' First ',
      }),
    ).toEqual({ aliases: ['first', 'zeta'] })
  })

  it('rejects self merges and aliases owned by a third entity', () => {
    expect(() =>
      planAliasMerge({
        destinationId: 'one',
        owners: [],
        sourceAliases: [],
        sourceId: 'one',
        sourceSlug: 'first',
      }),
    ).toThrow(new InvalidEntityMergeError('one', 'one'))
    expect(() =>
      planAliasMerge({
        destinationId: 'two',
        owners: [{ alias: ' FIRST ', entityId: 'three' }],
        sourceAliases: [],
        sourceId: 'one',
        sourceSlug: 'first',
      }),
    ).toThrow(new AliasClaimedError('first', 'three'))
  })
})
