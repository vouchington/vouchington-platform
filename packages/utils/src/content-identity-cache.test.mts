import { describe, expect, it, vi } from 'vitest'
import { ContentAndIdentityCache } from './content-identity-cache.mts'

describe('ContentAndIdentityCache', () => {
  it('skips content-key derivation on identity hits', () => {
    const cache = new ContentAndIdentityCache<object, string, number>()
    const identity = {}
    const getKey = vi.fn(() => 'k')
    const compute = vi.fn(() => 1)
    expect(cache.getOrCompute(identity, 'a', getKey, compute)).toBe(1)
    expect(cache.getOrCompute(identity, 'a', getKey, compute)).toBe(1)
    expect(getKey).toHaveBeenCalledOnce()
    expect(compute).toHaveBeenCalledOnce()
  })

  it('shares content across identities and sub-keys', () => {
    const cache = new ContentAndIdentityCache<object, string, number>()
    const compute = vi.fn(() => 7)
    cache.getOrCompute({}, 'a', () => 'k', compute)
    cache.getOrCompute({}, 'a', () => 'k', compute)
    const identity = {}
    cache.getOrCompute(identity, 'a', () => 'k', compute)
    cache.getOrCompute(identity, 'b', () => 'k', compute)
    expect(compute).toHaveBeenCalledOnce()
  })

  it('memoizes undefined values', () => {
    const cache = new ContentAndIdentityCache<object, string, undefined>()
    const identity = {}
    const compute = vi.fn(() => undefined)
    cache.getOrCompute(identity, 'a', () => 'k', compute)
    cache.getOrCompute(identity, 'a', () => 'k', compute)
    cache.getOrCompute(undefined, 'a', () => 'k', compute)
    expect(compute).toHaveBeenCalledOnce()
  })

  it('works without an identity key', () => {
    const cache = new ContentAndIdentityCache<object, string, number>()
    const compute = vi.fn(() => 2)
    expect(cache.getOrCompute(undefined, 'a', () => 'k', compute)).toBe(2)
    expect(cache.getOrCompute(undefined, 'a', () => 'k', compute)).toBe(2)
    expect(compute).toHaveBeenCalledOnce()
  })
})
