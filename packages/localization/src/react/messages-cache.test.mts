import { describe, expect, it, vi } from 'vitest'

import { cloneCatalog, mergeCatalogInPlace } from './merge-catalog.mts'
import { createFulfilledThenable, createMessagesCache } from './messages-cache.mts'

type Catalog = Record<string, unknown>

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('catalog merge', () => {
  it('merges nested objects and replaces scalars and arrays', () => {
    const target: Catalog = { a: { b: 1, c: [1] }, d: 'x', e: 'scalar' }
    mergeCatalogInPlace(target, { a: { b: 2, c: [2] }, e: { nested: true }, f: null })
    expect(target).toEqual({ a: { b: 2, c: [2] }, d: 'x', e: { nested: true }, f: null })
  })

  it('clones without sharing nested objects', () => {
    const source = { a: { b: 1 } }
    const copy = cloneCatalog(source)
    copy.a.b = 2
    expect(source.a.b).toBe(1)
  })
})

describe('createFulfilledThenable', () => {
  it('is pre-tagged as fulfilled', async () => {
    const thenable = createFulfilledThenable(5)
    expect(thenable.status).toBe('fulfilled')
    expect(thenable.value).toBe(5)
    await expect(thenable).resolves.toBe(5)
  })
})

describe('createMessagesCache', () => {
  it('loads once per locale', async () => {
    const load = vi.fn(async () => ({ a: 1 }))
    const cache = createMessagesCache<Catalog>(load)
    const first = cache.getMessagesPromise('en')
    expect(cache.getMessagesPromise('en')).toBe(first)
    await expect(first).resolves.toEqual({ a: 1 })
    expect(load).toHaveBeenCalledTimes(1)
  })

  it('seeds synchronously, first seed wins, and clones input', () => {
    const cache = createMessagesCache<Catalog>(vi.fn())
    const input = { a: { b: 1 } }
    cache.seedMessages('en', input)
    cache.seedMessages('en', { a: 2 })
    const seeded = cache.getMessagesPromise('en') as unknown as { status: string; value: Catalog }
    expect(seeded.status).toBe('fulfilled')
    expect(seeded.value).toEqual({ a: { b: 1 } })
    expect(seeded.value).not.toBe(input)
  })

  it('merges into a fulfilled entry', () => {
    const cache = createMessagesCache<Catalog>(vi.fn())
    cache.seedMessages('en', { a: 1 })
    cache.mergeMessages('en', { b: 2 })
    const seeded = cache.getMessagesPromise('en') as unknown as { value: Catalog }
    expect(seeded.value).toEqual({ a: 1, b: 2 })
  })

  it('seeds when merging into an empty locale', () => {
    const cache = createMessagesCache<Catalog>(vi.fn())
    cache.mergeMessages('es', { a: 1 })
    expect((cache.getMessagesPromise('es') as unknown as { value: Catalog }).value).toEqual({
      a: 1,
    })
  })

  it('merges after a pending load resolves', async () => {
    const cache = createMessagesCache<Catalog>(async () => ({ a: 1 }))
    const pending = cache.getMessagesPromise('en')
    cache.mergeMessages('en', { b: 2 })
    await flush()
    expect(await pending).toEqual({ a: 1, b: 2 })
  })

  it('drops a failed load, merges the incoming catalog, and allows reload', async () => {
    const load = vi
      .fn<(locale: string) => Promise<Catalog>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ ok: 1 })
    const cache = createMessagesCache<Catalog>(load)
    const failed = cache.getMessagesPromise('en')
    await expect(failed).rejects.toThrow('boom')
    cache.invalidateMessages('fr')
    cache.invalidateMessages('en')
    await expect(cache.getMessagesPromise('en')).resolves.toEqual({ ok: 1 })
  })

  it('replaces a failed entry when seeded and merges after a rejected pending load', async () => {
    const cache = createMessagesCache<Catalog>(() => Promise.reject(new Error('nope')))
    const failed = cache.getMessagesPromise('en')
    cache.mergeMessages('en', { b: 2 })
    await expect(failed).rejects.toThrow('nope')
    await flush()
    expect((cache.getMessagesPromise('en') as unknown as { value: Catalog }).value).toEqual({
      b: 2,
    })

    const second = createMessagesCache<Catalog>(() => Promise.reject(new Error('nope')))
    await expect(second.getMessagesPromise('en')).rejects.toThrow()
    await flush()
    second.seedMessages('en', { c: 3 })
    expect((second.getMessagesPromise('en') as unknown as { value: Catalog }).value).toEqual({
      c: 3,
    })
  })
})
