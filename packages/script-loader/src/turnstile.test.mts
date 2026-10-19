// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { resetScriptLoaderForTests, useLoadScript } from './index.mts'
import { TURNSTILE_SCRIPT_SRC, useTurnstile, type TurnstileRenderParameters } from './turnstile.mts'

const CUSTOM_SRC = 'https://example.com/turnstile.js'

describe('useTurnstile', () => {
  beforeEach(() => {
    resetScriptLoaderForTests()
    document.head.querySelectorAll('script').forEach((script) => script.remove())
    delete window.turnstile
  })

  it('loads nothing when disabled', () => {
    const { result } = renderHook(() =>
      useTurnstile({ siteKey: 'site', enabled: false, onSuccess: vi.fn() }),
    )

    expect(document.head.querySelector('script')).toBeNull()
    expect(result.current.isError).toBe(false)
    act(() => result.current.reset())
  })

  it('renders after the container is mounted and the script loads', () => {
    const turnstile = installTurnstile()
    const { result } = renderHook(() => useTurnstile({ siteKey: 'site-key', onSuccess: vi.fn() }))
    const node = document.createElement('div')
    act(() => result.current.ref(node))
    expect(turnstile.render).not.toHaveBeenCalled()

    act(() => finishLoad())

    expect(turnstile.render).toHaveBeenCalledWith(
      node,
      expect.objectContaining({ sitekey: 'site-key' }),
    )
  })

  it('does not render before the container is attached', () => {
    const turnstile = installTurnstile()
    renderHook(() => useTurnstile({ siteKey: 'site-key', onSuccess: vi.fn() }))
    act(() => finishLoad())

    expect(turnstile.render).not.toHaveBeenCalled()
  })

  it('uses the latest callbacks without rendering again', () => {
    const turnstile = installTurnstile()
    const first = vi.fn()
    const second = vi.fn()
    const onExpire = vi.fn()
    const onError = vi.fn()
    const { result, rerender } = renderHook(
      ({ onSuccess }) => useTurnstile({ siteKey: 'site-key', onSuccess, onExpire, onError }),
      { initialProps: { onSuccess: first } },
    )
    act(() => {
      result.current.ref(document.createElement('div'))
      finishLoad()
    })

    rerender({ onSuccess: second })
    const options = renderOptions(turnstile)
    options.callback?.('token')
    options['expired-callback']?.()
    options['error-callback']?.()

    expect(first).not.toHaveBeenCalled()
    expect(second).toHaveBeenCalledWith('token')
    expect(onExpire).toHaveBeenCalledOnce()
    expect(onError).toHaveBeenCalledOnce()
    expect(turnstile.render).toHaveBeenCalledTimes(1)
  })

  it('calls onError when the script fails and tolerates a missing handler', () => {
    const onError = vi.fn()
    const handled = renderHook(() =>
      useTurnstile({ siteKey: 'site-key', onSuccess: vi.fn(), onError }),
    )
    act(() => finishError())
    expect(onError).toHaveBeenCalledOnce()
    expect(handled.result.current.isError).toBe(true)

    resetScriptLoaderForTests()
    document.head.querySelectorAll('script').forEach((script) => script.remove())
    const unhandled = renderHook(() =>
      useTurnstile({
        siteKey: 'site-key',
        onSuccess: vi.fn(),
        scriptSrc: `${TURNSTILE_SCRIPT_SRC}&bare=1`,
      }),
    )
    act(() => finishError())
    expect(unhandled.result.current.isError).toBe(true)
  })

  it('reports onError when scriptSrc changes between sources that already failed', () => {
    const firstError = vi.fn()
    const secondError = vi.fn()
    for (const src of [TURNSTILE_SCRIPT_SRC, CUSTOM_SRC]) {
      const loaded = renderHook(() => useLoadScript(src))
      act(() => {
        const scripts = [...document.head.querySelectorAll('script')]
        scripts.at(-1)?.onerror?.(new Event('error'))
      })
      loaded.unmount()
    }

    const hook = renderHook(
      ({ scriptSrc, onError }) =>
        useTurnstile({ siteKey: 'site-key', onSuccess: vi.fn(), scriptSrc, onError }),
      { initialProps: { scriptSrc: TURNSTILE_SCRIPT_SRC, onError: firstError } },
    )
    expect(firstError).toHaveBeenCalledOnce()

    hook.rerender({ scriptSrc: CUSTOM_SRC, onError: secondError })
    expect(secondError).toHaveBeenCalledOnce()
  })

  it('resets the rendered widget and removes it on unmount', () => {
    const turnstile = installTurnstile()
    const { result, unmount } = renderHook(() =>
      useTurnstile({ siteKey: 'site-key', onSuccess: vi.fn() }),
    )
    act(() => {
      finishLoad()
      result.current.ref(document.createElement('div'))
    })

    act(() => result.current.reset())
    expect(turnstile.reset).toHaveBeenCalledWith('widget-id')
    unmount()
    expect(turnstile.remove).toHaveBeenCalledWith('widget-id')
  })

  it('does not render or reset without window.turnstile', () => {
    const { result } = renderHook(() => useTurnstile({ siteKey: 'site-key', onSuccess: vi.fn() }))
    act(() => result.current.reset())
    act(() => {
      finishLoad()
      result.current.ref(document.createElement('div'))
    })
    act(() => result.current.reset())
    expect(window.turnstile).toBeUndefined()
  })

  it('ignores reset and removal when turnstile disappears', () => {
    const turnstile = installTurnstile()
    const { result, unmount } = renderHook(() =>
      useTurnstile({ siteKey: 'site-key', onSuccess: vi.fn(), scriptSrc: CUSTOM_SRC }),
    )
    act(() => {
      finishLoad()
      result.current.ref(document.createElement('div'))
    })
    delete window.turnstile
    act(() => result.current.reset())
    unmount()
    expect(turnstile.reset).not.toHaveBeenCalled()
    expect(turnstile.remove).not.toHaveBeenCalled()
  })

  it('re-renders when the site key changes and honors a custom script src', () => {
    const turnstile = installTurnstile()
    const { result, rerender } = renderHook(
      ({ siteKey }) => useTurnstile({ siteKey, scriptSrc: CUSTOM_SRC, onSuccess: vi.fn() }),
      { initialProps: { siteKey: 'first' } },
    )
    act(() => {
      finishLoad()
      result.current.ref(document.createElement('div'))
    })
    expect(scriptElement().src).toBe(CUSTOM_SRC)

    rerender({ siteKey: 'second' })
    expect(turnstile.remove).toHaveBeenCalledWith('widget-id')
    expect(turnstile.render).toHaveBeenLastCalledWith(
      expect.any(HTMLDivElement),
      expect.objectContaining({ sitekey: 'second' }),
    )
  })

  it('re-renders when scriptSrc changes between sources that are already loaded', () => {
    const turnstile = installTurnstile()
    const first = renderHook(() => useLoadScript(TURNSTILE_SCRIPT_SRC))
    const second = renderHook(() => useLoadScript(CUSTOM_SRC))
    act(() => {
      for (const script of document.head.querySelectorAll('script')) {
        script.onload?.(new Event('load'))
      }
    })
    first.unmount()
    second.unmount()

    const hook = renderHook(
      ({ scriptSrc }) => useTurnstile({ siteKey: 'site-key', onSuccess: vi.fn(), scriptSrc }),
      { initialProps: { scriptSrc: TURNSTILE_SCRIPT_SRC } },
    )
    act(() => {
      hook.result.current.ref(document.createElement('div'))
    })
    hook.rerender({ scriptSrc: CUSTOM_SRC })

    expect(turnstile.remove).toHaveBeenCalledTimes(1)
    expect(turnstile.render).toHaveBeenCalledTimes(2)
  })

  it('invokes omitted widget callbacks without throwing', () => {
    const turnstile = installTurnstile()
    const { result } = renderHook(() =>
      useTurnstile({ siteKey: 'site-key', onSuccess: vi.fn(), scriptSrc: `${CUSTOM_SRC}?plain=1` }),
    )
    act(() => {
      finishLoad()
      result.current.ref(document.createElement('div'))
    })
    const options = renderOptions(turnstile)

    expect(() => options['expired-callback']?.()).not.toThrow()
    expect(() => options['error-callback']?.()).not.toThrow()
  })
})

function installTurnstile() {
  const turnstile = {
    render: vi.fn(() => 'widget-id'),
    reset: vi.fn(),
    remove: vi.fn(),
    getResponse: vi.fn(() => undefined),
  }
  window.turnstile = turnstile
  return turnstile
}

function finishLoad() {
  scriptElement().onload?.(new Event('load'))
}

function finishError() {
  scriptElement().onerror?.(new Event('error'))
}

function scriptElement(): HTMLScriptElement {
  const script = document.head.querySelector('script')
  if (!script) throw new Error('expected a script')
  return script
}

function renderOptions(turnstile: {
  render: { mock: { calls: readonly (readonly unknown[])[] } }
}): TurnstileRenderParameters {
  const options = turnstile.render.mock.calls[0]?.[1]
  if (options === undefined || typeof options !== 'object') {
    throw new Error('expected render options')
  }
  return options as TurnstileRenderParameters
}
