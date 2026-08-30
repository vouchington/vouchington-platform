import { describe, expect, it } from 'vitest'

import {
  HostnameClaimedError,
  InvalidHostnameClaimError,
  InvalidHostnameError,
  normalizeHostname,
  planHostnameClaim,
} from './index.mts'

describe('hostname rules', () => {
  it('normalizes ASCII hostnames and rejects invalid values', () => {
    expect(normalizeHostname('WWW.Example.TEST')).toBe('www.example.test')
    expect(() => normalizeHostname('not a hostname')).toThrow(
      new InvalidHostnameError('not a hostname'),
    )
    expect(() => normalizeHostname('example.test', () => '')).toThrow(
      new InvalidHostnameError('example.test'),
    )
  })

  it('plans an unclaimed additional hostname', () => {
    expect(
      planHostnameClaim({
        requestedClaim: null,
        currentPrimary: null,
        entityId: 'one',
        kind: 'additional',
        value: 'one.test',
      }),
    ).toEqual({
      claim: { entityId: 'one', hostname: 'one.test', kind: 'additional' },
      hostname: 'one.test',
      releases: [],
      write: true,
    })
  })

  it('preserves a same-owner claim with the same kind', () => {
    const existing = { entityId: 'one', hostname: 'one.test', kind: 'primary' } as const
    expect(
      planHostnameClaim({
        requestedClaim: existing,
        currentPrimary: existing,
        entityId: 'one',
        kind: 'primary',
        value: 'one.test',
      }),
    ).toEqual({ claim: existing, hostname: 'one.test', releases: [], write: false })
  })

  it('releases the old primary when setting a new primary', () => {
    const primary = { entityId: 'one', hostname: 'old.test', kind: 'primary' } as const
    expect(
      planHostnameClaim({
        requestedClaim: null,
        currentPrimary: primary,
        entityId: 'one',
        kind: 'primary',
        value: 'new.test',
      }),
    ).toEqual({
      claim: { entityId: 'one', hostname: 'new.test', kind: 'primary' },
      hostname: 'new.test',
      releases: [primary],
      write: true,
    })
  })

  it('promotes an owned additional hostname by replacing its old claim', () => {
    const additional = { entityId: 'one', hostname: 'one.test', kind: 'additional' } as const
    expect(
      planHostnameClaim({
        requestedClaim: additional,
        currentPrimary: null,
        entityId: 'one',
        kind: 'primary',
        value: 'one.test',
      }),
    ).toEqual({
      claim: { entityId: 'one', hostname: 'one.test', kind: 'primary' },
      hostname: 'one.test',
      releases: [additional],
      write: true,
    })
  })

  it('rejects a foreign claim unless the application permits reclamation', () => {
    const foreign = { entityId: 'two', hostname: 'shared.test', kind: 'additional' } as const
    expect(() =>
      planHostnameClaim({
        requestedClaim: foreign,
        currentPrimary: null,
        entityId: 'one',
        kind: 'additional',
        value: 'shared.test',
      }),
    ).toThrow(new HostnameClaimedError('shared.test', 'two'))
    expect(
      planHostnameClaim({
        requestedClaim: foreign,
        currentPrimary: null,
        entityId: 'one',
        kind: 'additional',
        mayReclaim: true,
        value: 'shared.test',
      }),
    ).toMatchObject({ releases: [foreign], write: true })
  })

  it('sorts multiple releases for deterministic application writes', () => {
    const foreign = { entityId: 'two', hostname: 'z.test', kind: 'additional' } as const
    const primary = { entityId: 'one', hostname: 'a.test', kind: 'primary' } as const
    expect(
      planHostnameClaim({
        currentPrimary: primary,
        entityId: 'one',
        kind: 'primary',
        mayReclaim: true,
        requestedClaim: foreign,
        value: 'z.test',
      }).releases,
    ).toEqual([primary, foreign])
  })

  it('rejects changing an owned primary into an additional hostname', () => {
    const primary = { entityId: 'one', hostname: 'one.test', kind: 'primary' } as const
    expect(() =>
      planHostnameClaim({
        requestedClaim: primary,
        currentPrimary: primary,
        entityId: 'one',
        kind: 'additional',
        value: 'one.test',
      }),
    ).toThrow(
      new InvalidHostnameClaimError(
        'one.test',
        'a primary claim cannot be downgraded to additional; remove the primary claim first',
      ),
    )
  })
})
