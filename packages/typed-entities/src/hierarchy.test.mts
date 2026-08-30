import { describe, expect, it } from 'vitest'

import { HierarchyCycleError, PolicyDeniedError } from './index.mts'
import { fixture } from './test-helpers.mts'

describe('hierarchies', () => {
  it('maintains multiple parents and exposes both directions', async () => {
    const subject = fixture()
    await subject.engine.addParent(subject.context, 'three', 'one')
    await subject.engine.addParent(subject.context, 'three', 'two')
    await subject.engine.addParent(subject.context, 'three', 'two')
    await expect(subject.engine.listParents(subject.context, 'three')).resolves.toEqual([
      'one',
      'two',
    ])
    await expect(subject.engine.listChildren(subject.context, 'one')).resolves.toEqual(['three'])
    await subject.engine.removeParent(subject.context, 'three', 'two')
    await subject.engine.removeParent(subject.context, 'three', 'two')
    await expect(subject.engine.listParents(subject.context, 'three')).resolves.toEqual(['one'])
    expect(subject.locks.filter((value) => value === 'hierarchy')).toHaveLength(5)
  })

  it('rejects self and multi-hop cycles while leaving the graph untouched', async () => {
    const subject = fixture()
    await expect(subject.engine.addParent(subject.context, 'one', 'one')).rejects.toEqual(
      new HierarchyCycleError('one', 'one'),
    )
    await subject.engine.addParent(subject.context, 'two', 'one')
    await subject.engine.addParent(subject.context, 'three', 'two')
    await expect(subject.engine.addParent(subject.context, 'one', 'three')).rejects.toEqual(
      new HierarchyCycleError('one', 'three'),
    )
    await expect(subject.engine.listParents(subject.context, 'one')).resolves.toEqual([])
  })

  it('validates a parent relation without performing the application-owned write', async () => {
    const subject = fixture()
    await subject.engine.addParent(subject.context, 'two', 'one')
    await expect(
      subject.engine.validateParent(subject.context, 'three', 'two'),
    ).resolves.toBeUndefined()
    await expect(subject.engine.listParents(subject.context, 'three')).resolves.toEqual([])
    await subject.engine.addParent(subject.context, 'three', 'two')
    await expect(subject.engine.validateParent(subject.context, 'one', 'three')).rejects.toEqual(
      new HierarchyCycleError('one', 'three'),
    )
  })

  it('walks converging parent paths once', async () => {
    const subject = fixture()
    subject.entities.set('four', { id: 'four', slug: 'fourth', type: 'group' })
    await subject.engine.addParent(subject.context, 'one', 'two')
    await subject.engine.addParent(subject.context, 'one', 'three')
    await subject.engine.addParent(subject.context, 'two', 'place')
    await subject.engine.addParent(subject.context, 'three', 'place')
    await expect(subject.engine.addParent(subject.context, 'four', 'one')).resolves.toBeUndefined()
  })

  it('applies application policy to additions and removals', async () => {
    const subject = fixture({
      catalog: {
        group: { canParent: ({ context }) => context.actor === 'admin' },
        place: {},
      },
    })
    await expect(subject.engine.addParent(subject.context, 'two', 'one')).rejects.toEqual(
      new PolicyDeniedError('add parent', 'group'),
    )
    await subject.engine.addParent({ actor: 'admin' }, 'two', 'one')
    await expect(subject.engine.removeParent(subject.context, 'two', 'one')).rejects.toEqual(
      new PolicyDeniedError('remove parent', 'group'),
    )
  })

  it('rejects new relationships to inactive parents', async () => {
    const subject = fixture({
      catalog: {
        group: { isActive: ({ entity }) => entity.id !== 'one' },
        place: {},
      },
    })
    await expect(subject.engine.addParent(subject.context, 'two', 'one')).rejects.toEqual(
      new PolicyDeniedError('use inactive entity', 'group'),
    )
    subject.state.parents.set('two', new Set(['one']))
    await expect(
      subject.engine.removeParent(subject.context, 'two', 'one'),
    ).resolves.toBeUndefined()
  })
})
