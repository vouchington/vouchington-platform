import { describe, expect, it, vi } from 'vitest'

import { extractLeadingQueryAnnotation } from './prepared-statement-name.mts'
import { createTransactionLockOnce } from './transaction-lock-once.mts'
import type { TransactionQuery } from './types.mts'

function fakeQuery(
  impl: (text: string, values?: readonly unknown[]) => Promise<unknown> = async () => ({}),
) {
  const fn = vi.fn(impl)
  return Object.assign(fn, { client: {} }) as unknown as TransactionQuery & typeof fn
}

const options = { namespace: 'ns:', annotation: 'lockThings' }

describe('createTransactionLockOnce', () => {
  it('normalizes, deduplicates and sorts ids into one annotated statement', async () => {
    const query = fakeQuery()
    const { lock } = createTransactionLockOnce(options)
    await lock(query, ['B', 'a', 'b', 'A', 'c'])
    expect(query).toHaveBeenCalledTimes(1)
    const [text, values] = query.mock.calls[0]!
    expect(values).toEqual(['ns:', ['a', 'b', 'c']])
    expect(extractLeadingQueryAnnotation(text)).toBe('lockThings')
    expect(text).toContain('pg_advisory_xact_lock(hashtextextended($1 || id, 0))')
    expect(text).toContain('ORDER BY position')
  })

  it('uses a custom normalize', async () => {
    const query = fakeQuery()
    const { lock } = createTransactionLockOnce({ ...options, normalize: (id) => id.trim() })
    await lock(query, [' B', 'A '])
    expect(query.mock.calls[0]![1]).toEqual(['ns:', ['A', 'B']])
  })

  it('skips held ids and sends nothing for empty or fully held input', async () => {
    const query = fakeQuery()
    const { lock } = createTransactionLockOnce(options)
    await lock(query, [])
    expect(query).not.toHaveBeenCalled()
    await lock(query, ['a', 'b'])
    await lock(query, ['A', 'b'])
    expect(query).toHaveBeenCalledTimes(1)
    await lock(query, ['a', 'c'])
    expect(query).toHaveBeenCalledTimes(2)
    expect(query.mock.calls[1]![1]).toEqual(['ns:', ['c']])
  })

  it('sends one statement per disjoint concurrent call and none for overlapping ids', async () => {
    const query = fakeQuery(() => new Promise((resolve) => setTimeout(resolve, 5)))
    const { lock } = createTransactionLockOnce(options)
    await Promise.all([
      lock(query, ['a']),
      lock(query, ['b']),
      lock(query, ['a', 'b']),
      lock(query, ['A']),
    ])
    expect(query.mock.calls.map((call) => call[1])).toEqual([
      ['ns:', ['a']],
      ['ns:', ['b']],
    ])
  })

  it('runs concurrent statements one at a time, in submission order', async () => {
    let active = 0
    let maxActive = 0
    const query = fakeQuery(async () => {
      maxActive = Math.max(maxActive, ++active)
      await new Promise((resolve) => setTimeout(resolve, 2))
      active--
    })
    const { lock } = createTransactionLockOnce(options)
    await Promise.all(['c', 'a', 'b'].map((id) => lock(query, [id])))
    expect(maxActive).toBe(1)
    expect(query.mock.calls.map((call) => (call[1] as unknown[][])[1])).toEqual([
      ['c'],
      ['a'],
      ['b'],
    ])
  })

  it('rejects only the failed caller, records nothing, and lets a retry succeed', async () => {
    const query = fakeQuery()
    query.mockRejectedValueOnce(new Error('boom'))
    const { lock } = createTransactionLockOnce(options)
    const first = lock(query, ['a'])
    const second = lock(query, ['b'])
    await expect(first).rejects.toThrow('boom')
    await expect(second).resolves.toBeUndefined()
    await expect(lock(query, ['a'])).resolves.toBeUndefined()
    expect(query.mock.calls.map((call) => call[1])).toEqual([
      ['ns:', ['a']],
      ['ns:', ['b']],
      ['ns:', ['a']],
    ])
  })

  it('records held ids only after the statement succeeds', async () => {
    let release!: () => void
    const query = fakeQuery(() => new Promise<void>((resolve) => (release = resolve)))
    const { lock } = createTransactionLockOnce(options)
    const pending = lock(query, ['a'])
    const overlapping = lock(query, ['a'])
    await Promise.resolve()
    release()
    await pending
    await overlapping
    expect(query).toHaveBeenCalledTimes(1)
  })

  it('records the ids a custom acquire reports locking', async () => {
    const query = fakeQuery()
    const acquire = vi.fn(async (_query: TransactionQuery, ids: readonly string[]) => [
      ...ids,
      'Parent',
    ])
    const { lock } = createTransactionLockOnce({ ...options, acquire })
    await lock(query, ['b', 'A'])
    expect(acquire).toHaveBeenCalledWith(query, ['a', 'b'])
    expect(query).not.toHaveBeenCalled()
    await lock(query, ['parent', 'a'])
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it('marks the requested ids when a custom acquire returns nothing', async () => {
    const query = fakeQuery()
    const acquire = vi.fn(async () => {})
    const { lock } = createTransactionLockOnce({ ...options, acquire })
    await lock(query, ['a'])
    await lock(query, ['a'])
    expect(acquire).toHaveBeenCalledTimes(1)
  })

  it('markHeld skips later locks without sending a statement', async () => {
    const query = fakeQuery()
    const { lock, markHeld } = createTransactionLockOnce(options)
    markHeld(query, ['A', 'b'])
    await lock(query, ['a', 'B'])
    expect(query).not.toHaveBeenCalled()
    await lock(query, ['a', 'c'])
    expect(query.mock.calls[0]![1]).toEqual(['ns:', ['c']])
  })

  it('does not share state between query objects or lock instances', async () => {
    const first = fakeQuery()
    const second = fakeQuery()
    const a = createTransactionLockOnce(options)
    const b = createTransactionLockOnce(options)
    await a.lock(first, ['x'])
    await a.lock(second, ['x'])
    await b.lock(first, ['x'])
    expect(first).toHaveBeenCalledTimes(2)
    expect(second).toHaveBeenCalledTimes(1)
  })

  it('rejects unusable annotations', () => {
    expect(() => createTransactionLockOnce({ ...options, annotation: '  ' })).toThrow(TypeError)
    expect(() => createTransactionLockOnce({ ...options, annotation: 'a */ SELECT 1' })).toThrow(
      TypeError,
    )
  })
})
