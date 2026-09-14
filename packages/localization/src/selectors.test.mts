import { describe, expect, it } from 'vitest'
import { chromeSelectorId, routeSelectorId } from './selectors.mts'

describe('stable route selector ids', () => {
  it('uses sorted unique aliases and confines route identity to its own membership', () => {
    expect(chromeSelectorId(['web.nav.b', 'web.nav.a'])).toBe(
      chromeSelectorId(['web.nav.a', 'web.nav.b', 'web.nav.a']),
    )
    expect(routeSelectorId('/one', ['web.one.a'])).not.toBe(routeSelectorId('/two', ['web.one.a']))
    expect(routeSelectorId('/one', ['web.one.a'])).not.toBe(routeSelectorId('/one', ['web.one.b']))
    expect(chromeSelectorId([])).toMatch(/^web\.chrome\.[a-f0-9]{16}$/)
    expect(routeSelectorId('/one', [])).toMatch(/^web\.route\.[a-f0-9]{16}\.[a-f0-9]{16}$/)
    expect(() => routeSelectorId('', [])).toThrow(/non-empty/)
    expect(() => routeSelectorId(1 as unknown as string, [])).toThrow(/non-empty/)
  })
})
