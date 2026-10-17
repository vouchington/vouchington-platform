import { describe, expect, it } from 'vitest'
import { withSpikeProtection, type SpikeProtectableEvent } from './spike-protection.mts'

const identity = (event: SpikeProtectableEvent) => event

describe('withSpikeProtection', () => {
  it('drops identical errors past the limit and resets after the window', () => {
    let now = 0
    const guarded = withSpikeProtection(identity, { limit: 2, windowMs: 100, now: () => now })
    const error = { exception: { values: [{ type: 'Error', value: 'boom' }] } }
    expect(guarded(error, undefined)).toBe(error)
    expect(guarded(error, undefined)).toBe(error)
    expect(guarded(error, undefined)).toBeNull()
    now = 150
    expect(guarded(error, undefined)).toBe(error)
  })

  it('fingerprints by explicit fingerprint, message, and exception type or value', () => {
    const guarded = withSpikeProtection(identity, { limit: 1 })
    expect(guarded({ fingerprint: ['a', 'b'] }, undefined)).not.toBeNull()
    expect(guarded({ fingerprint: ['a', 'b'] }, undefined)).toBeNull()
    expect(guarded({ message: 'm' }, undefined)).not.toBeNull()
    expect(guarded({ message: 'm' }, undefined)).toBeNull()
    expect(guarded({ exception: { values: [{ value: 'only value' }] } }, undefined)).not.toBeNull()
    expect(guarded({ exception: { values: [{ type: 'OnlyType' }] } }, undefined)).not.toBeNull()
    expect(guarded({ exception: { values: [{ type: 'OnlyType' }] } }, undefined)).toBeNull()
    expect(guarded({ fingerprint: [], message: 'fallback' }, undefined)).not.toBeNull()
  })

  it('never suppresses events with no identity', () => {
    const guarded = withSpikeProtection(identity, { limit: 0 })
    const anonymous = {}
    expect(guarded(anonymous, undefined)).toBe(anonymous)
    expect(guarded({ exception: { values: [{}] } }, undefined)).not.toBeNull()
    expect(guarded({ exception: {} }, undefined)).not.toBeNull()
  })

  it('passes dropped results through, including async ones', async () => {
    const dropped = withSpikeProtection(() => null)
    expect(dropped({ message: 'x' }, undefined)).toBeNull()
    const asyncDropped = withSpikeProtection(async () => null)
    await expect(asyncDropped({ message: 'x' }, undefined)).resolves.toBeNull()
    const asyncKept = withSpikeProtection(async (event: SpikeProtectableEvent) => event, {
      limit: 1,
    })
    await expect(asyncKept({ message: 'y' }, undefined)).resolves.toEqual({ message: 'y' })
    await expect(asyncKept({ message: 'y' }, undefined)).resolves.toBeNull()
  })

  it('treats functions with a then method as promise-like', async () => {
    // oxlint-disable-next-line unicorn/no-thenable
    const thenable = Object.defineProperty(() => undefined, 'then', {
      value: (resolve: (value: SpikeProtectableEvent) => void) =>
        Promise.resolve({ message: 'z' }).then(resolve),
    })
    const guarded = withSpikeProtection(
      () => thenable as unknown as PromiseLike<SpikeProtectableEvent>,
    )
    await expect(guarded({}, undefined)).resolves.toEqual({ message: 'z' })
  })
})
