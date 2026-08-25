import { describe, expect, it, vi } from 'vitest'

import { DnsTimeoutError, hasDnsTxtRecord, resolveTxtRecords, type DnsClock } from './dns.mts'

describe('resolveTxtRecords', () => {
  it('flattens records and checks for an exact verification record', async () => {
    const lookup = vi.fn().mockResolvedValue([['one', 'two'], ['three']])
    await expect(resolveTxtRecords('example.test', { lookup })).resolves.toEqual([
      'one',
      'two',
      'three',
    ])
    await expect(hasDnsTxtRecord('example.test', 'two', { lookup })).resolves.toBe(true)
    await expect(hasDnsTxtRecord('example.test', 'missing', { lookup })).resolves.toBe(false)
  })

  it('retries only timed-out lookups', async () => {
    const { clock, fire } = clockFixture()
    const lookup = vi
      .fn()
      .mockResolvedValueOnce(new Promise<string[][]>(() => {}))
      .mockResolvedValueOnce([['ok']])
    const pending = resolveTxtRecords('example.test', { lookup, clock, timeoutMs: 1, retries: 1 })
    fire()
    await expect(pending).resolves.toEqual(['ok'])
    expect(lookup).toHaveBeenCalledTimes(2)
  })

  it('returns the definitive lookup error and timeout after the configured attempts', async () => {
    const failure = new Error('NXDOMAIN')
    await expect(
      resolveTxtRecords('example.test', {
        lookup: async () => {
          throw failure
        },
      }),
    ).rejects.toBe(failure)
    const { clock, fire } = clockFixture()
    const lookup = vi.fn().mockResolvedValue(new Promise<string[][]>(() => {}))
    const pending = resolveTxtRecords('example.test', { lookup, clock, timeoutMs: 1, retries: 1 })
    fire()
    await Promise.resolve()
    fire()
    await expect(pending).rejects.toBeInstanceOf(DnsTimeoutError)
    expect(lookup).toHaveBeenCalledTimes(2)
    await expect(
      resolveTxtRecords('example.test', {
        lookup: async () => {
          throw 'unavailable'
        },
      }),
    ).rejects.toThrow('unavailable')
  })

  it('validates retry and timeout configuration', async () => {
    for (const overrides of [{ timeoutMs: 0 }, { retries: -1 }, { retries: 0.5 }]) {
      await expect(
        resolveTxtRecords('example.test', { lookup: async () => [], ...overrides }),
      ).rejects.toThrow('safe integer')
    }
  })
})

function clockFixture() {
  let callback: (() => void) | undefined
  const clock: DnsClock = {
    setTimeout: vi.fn((next: () => void) => {
      callback = next
      return 0 as unknown as ReturnType<typeof setTimeout>
    }),
    clearTimeout: vi.fn(),
  }
  return { clock, fire: () => callback?.() }
}
