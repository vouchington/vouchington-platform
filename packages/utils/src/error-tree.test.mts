import { describe, expect, it } from 'vitest'
import { formatErrorTree } from './error-tree.mts'

describe('formatErrorTree', () => {
  it('prints a plain error stack', () => {
    const error = new Error('plain failure')

    expect(formatErrorTree(error)).toBe(error.stack)
  })

  it('prints aggregate entries with labels', () => {
    const first = new Error('first failure')
    first.stack = 'Error: first failure\n    at synthetic-frame'
    const error = new AggregateError([first, new Error('second failure')], 'outer')
    const formatted = formatErrorTree(error)

    expect(formatted).toContain('errors[0]: Error: first failure')
    expect(formatted).toContain('\n      at synthetic-frame')
    expect(formatted).toContain('errors[1]: Error: second failure')
  })

  it('prints an errors array on an ordinary error and falls back when there is no stack', () => {
    const error = Object.assign(new Error('outer'), { errors: [new Error('inner')] })
    Object.defineProperty(error, 'stack', { value: undefined })

    expect(formatErrorTree(error)).toContain('Error: outer\n  errors[0]: Error: inner')
  })

  it('falls back to the Error name when the name is empty', () => {
    const error = new Error('anonymous')
    error.name = ''
    error.stack = ''

    expect(formatErrorTree(error)).toBe('Error: anonymous')
  })

  it('prints causes nested inside aggregate entries', () => {
    const root = new Error('root cause')
    const middle = new Error('middle cause', { cause: root })
    const formatted = formatErrorTree(new AggregateError([middle], 'outer'))

    expect(formatted).toContain('errors[0]: Error: middle cause')
    expect(formatted).toContain('cause: Error: root cause')
  })

  it('terminates cause cycles with a marker', () => {
    const first = new Error('first') as Error & { cause?: unknown }
    const second = new Error('second') as Error & { cause?: unknown }
    first.cause = second
    second.cause = first

    expect(formatErrorTree(first)).toContain('[circular]')
  })

  it('counts repeated nested entries against the shared error budget', () => {
    const shared = new Error('reused')
    const formatted = formatErrorTree(
      new AggregateError(
        Array.from({ length: 25 }, () => shared),
        'outer',
      ),
    )

    expect(formatted).toContain('errors[1]: [circular]')
    expect(formatted).not.toContain('errors[20]:')
    expect(formatted).toContain('… 5 more nested errors omitted')
  })

  it('caps aggregate entries and reports the exact omitted count', () => {
    const errors = Array.from({ length: 25 }, (_, index) => new Error(`failure-${index}`))
    const formatted = formatErrorTree(new AggregateError(errors, 'outer'))

    expect(formatted).toContain('errors[19]: Error: failure-19')
    expect(formatted).not.toContain('failure-20')
    expect(formatted).toContain('… 5 more nested errors omitted')
  })

  it('caps depth and counts all descendants beyond the limit', () => {
    let error: Error & { cause?: unknown } = new Error('level-7')
    for (let level = 6; level >= 0; level -= 1) {
      error = Object.assign(new Error(`level-${level}`), { cause: error })
    }
    const formatted = formatErrorTree(error)

    expect(formatted).toContain('Error: level-5')
    expect(formatted).not.toContain('level-6')
    expect(formatted).toContain('… 2 more nested errors omitted')
  })

  it('counts a repeated cycle edge omitted at the depth limit once', () => {
    const root = new Error('level-0') as Error & { cause?: unknown }
    let error = root
    for (let level = 1; level <= 5; level += 1) {
      const nested = new Error(`level-${level}`) as Error & { cause?: unknown }
      error.cause = nested
      error = nested
    }
    error.cause = root

    const formatted = formatErrorTree(root)

    expect(formatted).toContain('Error: level-5')
    expect(formatted).not.toContain('[circular]')
    expect(formatted).toContain('… 1 more nested errors omitted')
  })

  it('inspects non-Error nested values', () => {
    const formatted = formatErrorTree(new AggregateError(['raw failure', { code: 42 }], 'outer'))

    expect(formatted).toContain("errors[0]: 'raw failure'")
    expect(formatted).toContain('errors[1]: { code: 42 }')
  })

  it('inspects a non-object root', () => {
    expect(formatErrorTree('plain')).toBe("'plain'")
  })

  it('counts omitted primitive children', () => {
    const error = new AggregateError(['raw'], 'outer')

    expect(formatErrorTree(error, { maxDepth: 0 })).toContain('… 1 more nested errors omitted')
  })

  it('honors maxDepth and maxNested overrides', () => {
    const error = Object.assign(new Error('outer'), { cause: new Error('inner') })

    expect(formatErrorTree(error, { maxDepth: 0 })).toContain('… 1 more nested errors omitted')
    expect(formatErrorTree(error, { maxNested: 0 })).not.toContain('cause: Error: inner')
    expect(formatErrorTree(error, { maxNested: 1 })).toContain('cause: Error: inner')
  })
})
