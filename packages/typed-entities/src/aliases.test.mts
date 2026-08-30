import { describe, expect, it } from 'vitest'

import {
  AliasClaimedError,
  EntityNotFoundError,
  InvalidAliasError,
  InvalidEntityMergeError,
  PolicyDeniedError,
  UnknownEntityTypeError,
} from './index.mts'
import { fixture, type Entity } from './test-helpers.mts'

describe('aliases and merges', () => {
  it('normalizes, validates, deduplicates, and claims aliases atomically', async () => {
    const subject = fixture()
    await expect(subject.engine.claimAlias(subject.context, 'one', '  ALPHA ')).resolves.toBe(
      'alpha',
    )
    await expect(subject.engine.claimAlias(subject.context, 'one', '  TWO WORDS ')).resolves.toBe(
      'two words',
    )
    await subject.engine.claimAlias(subject.context, 'one', 'alpha')
    expect(subject.state.aliases).toEqual(
      new Map([
        ['alpha', 'one'],
        ['two words', 'one'],
      ]),
    )
    expect(subject.audits).toHaveLength(2)
    expect(subject.commits).toHaveLength(2)
    await expect(subject.engine.claimAlias(subject.context, 'one', '')).rejects.toEqual(
      new InvalidAliasError(''),
    )
  })

  it('lets applications inject stricter alias normalization and validation', async () => {
    const subject = fixture({ normalizeAlias: (value) => (/^#[a-z]+$/.test(value) ? value : null) })
    await expect(subject.engine.claimAlias(subject.context, 'one', 'alpha')).rejects.toEqual(
      new InvalidAliasError('alpha'),
    )
    await expect(subject.engine.claimAlias(subject.context, 'one', '#alpha')).resolves.toBe(
      '#alpha',
    )
  })

  it('transfers the source slug and every alias after a complete conflict check', async () => {
    const subject = fixture({ normalizeAlias: (value) => value.trim().toLowerCase() || null })
    await subject.engine.claimAlias(subject.context, 'one', 'FIRST')
    await subject.engine.claimAlias(subject.context, 'one', 'zeta')
    await subject.engine.merge(subject.context, 'one', 'two')
    expect(subject.state.aliases).toEqual(
      new Map([
        ['first', 'two'],
        ['zeta', 'two'],
      ]),
    )
    expect(subject.state.merges).toEqual([
      {
        aliases: ['first', 'zeta'],
        lifecycle: 'retired',
        sourceId: 'one',
        sourceSlug: 'First',
        targetId: 'two',
      },
    ])
    expect(subject.locks).toContain('entities:one,two')
    expect(subject.locks).toContain('aliases:first,zeta')
  })

  it('awaits asynchronous lifecycle projections before persistence and audit', async () => {
    const subject = fixture({
      catalog: {
        group: { projectLifecycle: async () => Promise.resolve('archived') },
        place: {},
      },
    })
    await subject.engine.merge(subject.context, 'one', 'two')
    expect(subject.state.merges[0]?.lifecycle).toBe('archived')
    expect(subject.audits.at(-1)).toMatchObject({ kind: 'entity.merged', lifecycle: 'archived' })
  })

  it('rolls back every merge write when an alias conflicts', async () => {
    const subject = fixture()
    await subject.engine.claimAlias(subject.context, 'one', 'zeta')
    await subject.engine.claimAlias(subject.context, 'three', 'first')
    await expect(subject.engine.merge(subject.context, 'one', 'two')).rejects.toEqual(
      new AliasClaimedError('first', 'three'),
    )
    expect(subject.state.aliases.get('zeta')).toBe('one')
    expect(subject.state.merges).toEqual([])
  })

  it('rejects an alias already claimed by another entity', async () => {
    const subject = fixture()
    await subject.engine.claimAlias(subject.context, 'one', 'shared')
    await expect(subject.engine.claimAlias(subject.context, 'two', 'shared')).rejects.toEqual(
      new AliasClaimedError('shared', 'one'),
    )
  })

  it('enforces catalog, activity, compatibility, and caller policy', async () => {
    const subject = fixture({
      catalog: {
        group: {
          canClaimAlias: ({ context }) => context.actor === 'admin',
          canMerge: () => true,
          isActive: ({ entity }) => entity.id !== 'two',
          isCompatible: ({ other }) => other.id !== 'three',
        },
        place: {},
      },
    })
    await expect(subject.engine.claimAlias(subject.context, 'one', 'alpha')).rejects.toEqual(
      new PolicyDeniedError('claim alias', 'group'),
    )
    await expect(subject.engine.merge({ actor: 'admin' }, 'one', 'two')).rejects.toEqual(
      new PolicyDeniedError('use inactive entity', 'group'),
    )
    await expect(subject.engine.merge({ actor: 'admin' }, 'one', 'three')).rejects.toEqual(
      new PolicyDeniedError('merge incompatible entity', 'group'),
    )
    await expect(subject.engine.merge({ actor: 'admin' }, 'one', 'place')).rejects.toEqual(
      new InvalidEntityMergeError('one', 'place'),
    )
    await expect(subject.engine.merge({ actor: 'admin' }, 'one', 'one')).rejects.toEqual(
      new InvalidEntityMergeError('one', 'one'),
    )
  })

  it('reports missing entities and types with stable domain codes', async () => {
    const subject = fixture()
    await expect(subject.engine.claimAlias(subject.context, 'missing', 'alias')).rejects.toEqual(
      new EntityNotFoundError('missing'),
    )
    subject.entities.set('unknown', {
      id: 'unknown',
      slug: 'unknown',
      type: 'other',
    } as unknown as Entity)
    await expect(subject.engine.claimAlias(subject.context, 'unknown', 'alias')).rejects.toEqual(
      new UnknownEntityTypeError('other'),
    )
    expect(new InvalidAliasError('x').code).toBe('INVALID_ALIAS')
  })
})
