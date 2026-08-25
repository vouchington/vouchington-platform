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
    expect(await mapWithConcurrency([1], Number.POSITIVE_INFINITY, async (value) => value)).toEqual(
      [1],
    )
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
})
