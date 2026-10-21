// @vitest-environment jsdom
import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useLoadScript } from './index.mts'
import { resetScriptLoaderForTests } from './testing.mts'

const SRC = 'https://cdn.example.com/sdk.js'

describe('useLoadScript', () => {
  beforeEach(() => {
    resetScriptLoaderForTests()
    vi.useRealTimers()
    document.head.querySelectorAll('script').forEach((script) => script.remove())
  })

  it('does not load an empty src', () => {
    const { result, unmount } = renderHook(() => useLoadScript(''))

    expect(result.current).toEqual({ isLoaded: false, isError: false })
    expect(document.head.querySelector('script')).toBeNull()
    unmount()
  })

  it('applies nonce, integrity, and crossOrigin, including an empty crossOrigin', async () => {
    const { unmount } = renderHook(() =>
      useLoadScript(SRC, {
        nonce: 'nonce-123',
        integrity: 'sha384-test',
        crossOrigin: 'anonymous',
      }),
    )
    const script = scriptElement()
    expect(script.nonce).toBe('nonce-123')
    expect(script.integrity).toBe('sha384-test')
    expect(script.crossOrigin).toBe('anonymous')
    unmount()
    resetScriptLoaderForTests()
    document.head.querySelectorAll('script').forEach((node) => node.remove())

    renderHook(() => useLoadScript(`${SRC}?empty`, { crossOrigin: '' }))
    expect(scriptElement().crossOrigin).toBe('')
  })

  it('shares one tag across hooks and reports onload', () => {
    const first = renderHook(() => useLoadScript(SRC))
    const second = renderHook(() => useLoadScript(SRC))
    expect(document.head.querySelectorAll('script')).toHaveLength(1)
    expect(first.result.current.isLoaded).toBe(false)

    act(() => {
      scriptElement().onload?.(new Event('load'))
    })

    expect(first.result.current).toEqual({ isLoaded: true, isError: false })
    expect(second.result.current.isLoaded).toBe(true)
  })

  it('reports onerror and does not insert another tag inside the retry TTL', async () => {
    vi.useFakeTimers()
    const { result, unmount } = renderHook(() => useLoadScript(SRC))
    act(() => {
      scriptElement().onerror?.(new Event('error'))
    })
    expect(result.current).toEqual({ isLoaded: false, isError: true })
    unmount()

    renderHook(() => useLoadScript(SRC))
    expect(document.head.querySelectorAll('script')).toHaveLength(1)
    await act(() => vi.advanceTimersByTimeAsync(30_000))
    renderHook(() => useLoadScript(SRC))
    expect(document.head.querySelectorAll('script')).toHaveLength(1)
  })

  it('retries a failed src after the TTL, including a custom retry interval', async () => {
    vi.useFakeTimers()
    const first = renderHook(() => useLoadScript(SRC, { errorRetryMs: 1000 }))
    act(() => {
      scriptElement().onerror?.(new Event('error'))
    })
    first.unmount()
    await act(() => vi.advanceTimersByTimeAsync(1000))
    renderHook(() => useLoadScript(SRC, { errorRetryMs: 1000 }))
    expect(document.head.querySelectorAll('script')).toHaveLength(1)

    await act(() => vi.advanceTimersByTimeAsync(1))
    renderHook(() => useLoadScript(SRC, { errorRetryMs: 1000 }))
    expect(document.head.querySelectorAll('script')).toHaveLength(2)
  })

  it('clears isError on a still-mounted hook when another caller retries', async () => {
    vi.useFakeTimers()
    const mounted = renderHook(() => useLoadScript(SRC, { errorRetryMs: 1000 }))
    act(() => {
      scriptElement().onerror?.(new Event('error'))
    })
    await act(() => vi.advanceTimersByTimeAsync(1001))
    renderHook(() => useLoadScript(SRC, { errorRetryMs: 1000 }))
    expect(mounted.result.current).toEqual({ isLoaded: false, isError: false })
  })

  it('stops notifying an unsubscribed hook and ignores a load with no listeners', () => {
    const first = renderHook(() => useLoadScript(SRC))
    const second = renderHook(() => useLoadScript(SRC))
    first.unmount()
    const script = scriptElement()
    second.unmount()

    expect(() => script.onload?.(new Event('load'))).not.toThrow()
    renderHook(() => useLoadScript(SRC))
    expect(document.head.querySelectorAll('script')).toHaveLength(1)
  })

  it('follows a new src', () => {
    const { result, rerender } = renderHook(({ src }) => useLoadScript(src), {
      initialProps: { src: SRC },
    })
    rerender({ src: `${SRC}?next` })
    expect(document.head.querySelectorAll('script')).toHaveLength(2)

    act(() => {
      const scripts = [...document.head.querySelectorAll('script')]
      scripts[1]?.onload?.(new Event('load'))
    })

    expect(result.current.isLoaded).toBe(true)
  })

  it('reports the server snapshot without inserting a script', () => {
    function Probe({ src }: { src: string }) {
      const state = useLoadScript(src)
      return createElement('span', null, `${state.isLoaded}:${state.isError}`)
    }

    expect(renderToString(createElement(Probe, { src: SRC }))).toBe('<span>false:false</span>')
    expect(document.head.querySelector('script')).toBeNull()
  })
})

function scriptElement(): HTMLScriptElement {
  const script = document.head.querySelector('script')
  if (!script) throw new Error('expected a script')
  return script
}
