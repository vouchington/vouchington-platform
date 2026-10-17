import { describe, expect, it } from 'vitest'
import { RequestContractValidatorRegistry } from './index.mts'

const registry = new RequestContractValidatorRegistry({
  components: {},
  operations: {
    create: { body: { type: 'object' } },
    read: { path: { type: 'object' }, query: { type: 'object' } },
    noSchema: {},
  },
})

describe('hasInputCarriers', () => {
  it('is true when any carrier has a contract', () => {
    expect(registry.hasInputCarriers('create')).toBe(true)
    expect(registry.hasInputCarriers('read')).toBe(true)
  })

  it('is false for an operation with no carrier contracts or an unknown operation', () => {
    expect(registry.hasInputCarriers('noSchema')).toBe(false)
    expect(registry.hasInputCarriers('missing')).toBe(false)
  })
})
