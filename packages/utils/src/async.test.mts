import { describe, expect, it } from 'vitest'
import { mapSerially, mapWithConcurrency } from './async.mts'

describe('bounded async mapping', () => {
  it('preserves input order and bounds parallel work', async () => {
    let active = 0
    let maximum = 0
    const values = await mapWithConcurrency([1, 2, 3], 2, async (value) => {
      active += 1
      maximum = Math.max(maximum, active)
      await Promise.resolve()
      active -= 1
      return value * 2
    })
    expect(values).toEqual([2, 4, 6])
    expect(maximum).toBeLessThanOrEqual(2)
    expect(await mapWithConcurrency([], 0, async (value) => value)).toEqual([])
    expect(await mapWithConcurrency([1, 2], 0, async (value) => value)).toEqual([1, 2])
    active = 0
    maximum = 0
    expect(
      await mapWithConcurrency([1, 2], Number.POSITIVE_INFINITY, async (value) => {
        active += 1
        maximum = Math.max(maximum, active)
        await Promise.resolve()
        active -= 1
        return value
      }),
    ).toEqual([1, 2])
    expect(maximum).toBe(2)
    expect(await mapSerially([1, 2], async (value) => value)).toEqual([1, 2])
  })
  it('rejects with the first observed failure after workers settle', async () => {
    await expect(
      mapWithConcurrency([1, 2], 1, async (value) => {
        if (value === 1) throw new Error('failed')
        return value
      }),
    ).rejects.toThrow('failed')
    await expect(mapWithConcurrency([1], 1, async () => Promise.reject(undefined))).rejects.toBe(
      undefined,
    )
  })
  it('handles large synchronously rejecting inputs without recursive stack growth', async () => {
    await expect(
      mapWithConcurrency(
        Array.from({ length: 20_000 }, (_, index) => index),
        1,
        async () => {
          throw new Error('failed')
        },
      ),
    ).rejects.toThrow('failed')
  })
})
