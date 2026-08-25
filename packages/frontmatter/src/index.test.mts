import { describe, expect, it } from 'vitest'
import { toFrontmatter } from './index.mts'
describe('frontmatter', () => {
  it('serializes deterministic YAML with normalized scalar values', () => {
    expect(
      toFrontmatter({ title: 'Say "hello"', yes: 'yes', count: '42', date: new Date(0) }),
    ).toBe(
      '---\ntitle: "Say \\"hello\\""\nyes: "yes"\ncount: "42"\ndate: 1970-01-01T00:00:00.000Z\n---',
    )
  })
  it('recursively normalizes nested objects and arrays', () => {
    expect(
      toFrontmatter({
        nested: { child: { enabled: true, omitted: null }, empty: [] },
        items: [{ label: 'one', omitted: undefined }, [new Date('2026-01-02T00:00:00Z')]],
      }),
    ).toBe(
      '---\nnested:\n  child:\n    enabled: true\nitems:\n  - label: one\n  - - 2026-01-02T00:00:00.000Z\n---',
    )
  })
  it('omits nullish fields and empty arrays', () => {
    expect(toFrontmatter({ absent: null, empty: [], tags: ['a', null, 'b'] })).toBe(
      '---\ntags:\n  - a\n  - b\n---',
    )
    expect(toFrontmatter({})).toBe('---\n---')
    expect(
      toFrontmatter({ items: [{ keep: true, omit: null }, {}, new Date(0), Symbol('x')] }),
    ).toBe('---\nitems:\n  - keep: true\n  - 1970-01-01T00:00:00.000Z\n  - Symbol(x)\n---')
  })
})
