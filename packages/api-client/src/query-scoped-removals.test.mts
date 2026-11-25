// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { pageHasContinuation, useQueryScopedRemovals } from './paginated-list.mts'

describe('pageHasContinuation', () => {
  it('returns true only when has_next_page is true and end_cursor is non-empty', () => {
    expect(pageHasContinuation({ has_next_page: true, end_cursor: 'cursor-1' })).toBe(true)
    expect(pageHasContinuation({ has_next_page: true, end_cursor: null })).toBe(false)
    expect(pageHasContinuation({ has_next_page: true, end_cursor: '' })).toBe(false)
    expect(pageHasContinuation({ has_next_page: false, end_cursor: 'cursor-1' })).toBe(false)
  })
})

describe('useQueryScopedRemovals', () => {
  it('accumulates removed ids for the active query and resets when queryKey changes', () => {
    const { result, rerender } = renderHook(({ key }) => useQueryScopedRemovals(key), {
      initialProps: { key: '/items|sort=hot' },
    })

    expect(result.current.removedIds.size).toBe(0)

    act(() => result.current.remove('id-1'))
    act(() => result.current.remove('id-2'))
    expect([...result.current.removedIds]).toEqual(['id-1', 'id-2'])

    rerender({ key: '/items|sort=new' })
    expect(result.current.removedIds.size).toBe(0)

    act(() => result.current.remove('id-3'))
    expect([...result.current.removedIds]).toEqual(['id-3'])
  })
})
