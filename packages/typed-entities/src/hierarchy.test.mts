import { describe, expect, it } from 'vitest'

import { assertAcyclicParent, HierarchyCycleError } from './index.mts'

describe('hierarchy rules', () => {
  it('allows a parent outside the proposed entity ancestry', () => {
    expect(() =>
      assertAcyclicParent({ ancestorIds: ['grandparent'], entityId: 'child', parentId: 'parent' }),
    ).not.toThrow()
  })

  it('rejects direct and multi-hop indirect cycles', () => {
    expect(() =>
      assertAcyclicParent({ ancestorIds: [], entityId: 'one', parentId: 'one' }),
    ).toThrow(new HierarchyCycleError('one', 'one'))
    expect(() =>
      assertAcyclicParent({ ancestorIds: ['root', 'one'], entityId: 'one', parentId: 'two' }),
    ).toThrow(new HierarchyCycleError('one', 'two'))
  })
})
