// @vitest-environment jsdom
import { act, fireEvent, render, screen } from '@testing-library/react'
import { createElement as h, startTransition, Suspense, use } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { usePaginatedList } from './paginated-list.mts'

type TestPage = {
  items: string[]
  page_info: { has_next_page: boolean; end_cursor: string | null }
}

function makePage(items: string[], endCursor: string | null): TestPage {
  return { items, page_info: { has_next_page: endCursor !== null, end_cursor: endCursor } }
}

describe('usePaginatedList concurrent rendering', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('keeps a committed continuation request current when a different query render is abandoned', async () => {
    let resolvePage!: (page: TestPage) => void
    const suspendedRender = new Promise<never>(() => {})
    const fetchPage = vi.fn(() => new Promise<TestPage>((resolve) => (resolvePage = resolve)))
    const firstInitial = makePage(['first-1'], 'first-cursor')
    const secondInitial = makePage(['second-1'], 'second-cursor')

    function PaginationHarness({ filter }: { filter: string }) {
      const pagination = usePaginatedList(
        filter === 'first' ? firstInitial : secondInitial,
        '/api/v1/items',
        { filter },
        { fetchPage },
      )
      if (filter === 'second') use(suspendedRender)
      return h(
        'button',
        { onClick: () => void pagination.loadMore(), type: 'button' },
        pagination.loadingMore
          ? 'Loading'
          : pagination.pages.flatMap((page) => page.items).join(','),
      )
    }
    const tree = (filter: string) =>
      h(Suspense, { fallback: h('p', null, 'Switching query') }, h(PaginationHarness, { filter }))

    const { rerender } = render(tree('first'))
    fireEvent.click(screen.getByRole('button', { name: 'first-1' }))
    expect(screen.getByRole('button', { name: 'Loading' })).toBeTruthy()

    await act(async () => {
      startTransition(() => {
        rerender(tree('second'))
      })
    })
    expect(screen.getByRole('button', { name: 'Loading' })).toBeTruthy()

    rerender(tree('first'))

    await act(async () => {
      resolvePage(makePage(['first-2'], null))
    })

    expect(screen.getByRole('button', { name: 'first-1,first-2' })).toBeTruthy()
  })
})
