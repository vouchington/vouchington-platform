import { describe, expect, it, vi } from 'vitest'

import { cloneCatalog, mergeCatalogInPlace } from './merge-catalog.mts'
import { createFulfilledThenable, createMessagesCache } from './messages-cache.mts'

type Catalog = Record<string, unknown>

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))
const valueOf = (promise: Promise<Catalog>) => (promise as unknown as { value: Catalog }).value

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

  it('clones arrays so caller mutation does not reach the copy', () => {
    const source: { list: Array<{ a: number } | string> } = { list: [{ a: 1 }, 'x'] }
    const copy = cloneCatalog(source)
    ;(source.list[0] as { a: number }).a = 2
    source.list.push('y')
    expect(copy).toEqual({ list: [{ a: 1 }, 'x'] })
  })

  it('never writes __proto__ or descends into inherited properties', () => {
    const target: Catalog = {}
    mergeCatalogInPlace(target, JSON.parse('{"__proto__":{"polluted":true},"constructor":{"x":1}}'))
    mergeCatalogInPlace(target, JSON.parse('{"toString":{"y":1},"prototype":{"z":1}}'))
    expect(({} as Catalog).polluted).toBeUndefined()
    expect(Object.keys(target)).toEqual(['constructor', 'toString', 'prototype'])
    expect(Object.getOwnPropertyDescriptor(target, 'constructor')?.value).toEqual({ x: 1 })
    expect(Object.getOwnPropertyDescriptor(target, 'prototype')?.value).toEqual({ z: 1 })
    expect(Object.getOwnPropertyDescriptor(target, 'toString')?.value).toEqual({ y: 1 })
    expect(Object.hasOwn(Object.prototype, 'y')).toBe(false)
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
    const seeded = cache.getMessagesPromise('en') as unknown as { status: string }
    expect(seeded.status).toBe('fulfilled')
    expect(valueOf(cache.getMessagesPromise('en'))).toEqual({ a: { b: 1 } })
    expect(valueOf(cache.getMessagesPromise('en'))).not.toBe(input)
  })

  it('merges into a fulfilled entry by replacing it with a new object', () => {
    const cache = createMessagesCache<Catalog>(vi.fn())
    cache.seedMessages('en', { a: 1 })
    const before = cache.getMessagesPromise('en')
    cache.mergeMessages('en', { b: 2 })
    const after = cache.getMessagesPromise('en')
    expect(after).not.toBe(before)
    expect(valueOf(before)).toEqual({ a: 1 })
    expect(valueOf(after)).toEqual({ a: 1, b: 2 })
  })

  it('seeds when merging into an empty locale', () => {
    const cache = createMessagesCache<Catalog>(vi.fn())
    cache.mergeMessages('es', { a: 1 })
    expect(valueOf(cache.getMessagesPromise('es'))).toEqual({ a: 1 })
  })

  it('hydrates immediately over a pending load, then folds the load underneath', async () => {
    let resolve!: (value: Catalog) => void
    const cache = createMessagesCache<Catalog>(() => new Promise<Catalog>((r) => (resolve = r)))
    void cache.getMessagesPromise('en')
    cache.mergeMessages('en', { route: 'r', shared: 'incoming' })
    expect(valueOf(cache.getMessagesPromise('en'))).toEqual({ route: 'r', shared: 'incoming' })
    cache.mergeMessages('en', { later: 'l' })
    resolve({ full: 'f', shared: 'loaded' })
    await flush()
    expect(valueOf(cache.getMessagesPromise('en'))).toEqual({
      full: 'f',
      shared: 'incoming',
      route: 'r',
      later: 'l',
    })
  })

  it('seeds over a pending load so hydration is synchronous, then folds the load underneath', async () => {
    let resolve!: (value: Catalog) => void
    const cache = createMessagesCache<Catalog>(() => new Promise<Catalog>((r) => (resolve = r)))
    void cache.getMessagesPromise('en')
    cache.seedMessages('en', { boot: 'b', shared: 'seeded' })
    const seeded = cache.getMessagesPromise('en') as unknown as { status: string }
    expect(seeded.status).toBe('fulfilled')
    expect(valueOf(cache.getMessagesPromise('en'))).toEqual({ boot: 'b', shared: 'seeded' })
    cache.seedMessages('en', { ignored: true })
    resolve({ full: 'f', shared: 'loaded' })
    await flush()
    expect(valueOf(cache.getMessagesPromise('en'))).toEqual({
      full: 'f',
      shared: 'seeded',
      boot: 'b',
    })
  })

  it('keeps the incoming catalog when the pending load fails', async () => {
    const cache = createMessagesCache<Catalog>(() => Promise.reject(new Error('nope')))
    const failed = cache.getMessagesPromise('en')
    cache.mergeMessages('en', { b: 2 })
    await expect(failed).rejects.toThrow('nope')
    await flush()
    expect(valueOf(cache.getMessagesPromise('en'))).toEqual({ b: 2 })
    cache.invalidateMessages('en')
    expect(valueOf(cache.getMessagesPromise('en'))).toEqual({ b: 2 })
  })

  it('keeps a failed load cached until invalidated, and a seed replaces it', async () => {
    const load = vi
      .fn<(locale: string) => Promise<Catalog>>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue({ ok: 1 })
    const cache = createMessagesCache<Catalog>(load)
    const failed = cache.getMessagesPromise('en')
    await expect(failed).rejects.toThrow('boom')
    expect(cache.getMessagesPromise('en')).toBe(failed)
    cache.invalidateMessages('fr')
    cache.invalidateMessages('en')
    await expect(cache.getMessagesPromise('en')).resolves.toEqual({ ok: 1 })
    cache.invalidateMessages('en')

    const second = createMessagesCache<Catalog>(() => Promise.reject(new Error('nope')))
    await expect(second.getMessagesPromise('en')).rejects.toThrow()
    second.seedMessages('en', { c: 3 })
    expect(valueOf(second.getMessagesPromise('en'))).toEqual({ c: 3 })
  })
})
