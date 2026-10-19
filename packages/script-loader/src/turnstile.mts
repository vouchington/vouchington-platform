import { useCallback, useEffect, useRef, useState } from 'react'
import { useLoadScript } from './index.mts'

export const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit'

export interface TurnstileRenderParameters {
  sitekey: string
  callback?: (token: string) => void
  'expired-callback'?: () => void
  'error-callback'?: () => void
}

export interface TurnstileApi {
  render: (container: HTMLElement, options: TurnstileRenderParameters) => string
  reset: (widgetId: string) => void
  remove: (widgetId: string) => void
  getResponse: (widgetId: string) => string | undefined
}

declare global {
  interface Window {
    turnstile?: TurnstileApi
  }
}

export interface UseTurnstileOptions {
  siteKey: string
  onSuccess: (token: string) => void
  onExpire?: () => void
  onError?: () => void
  /** When false, no script is loaded. */
  enabled?: boolean
  /** Defaults to TURNSTILE_SCRIPT_SRC. */
  scriptSrc?: string
}

export interface UseTurnstileReturn {
  ref: (node: HTMLDivElement | null) => void
  reset: () => void
  isError: boolean
}

export function useTurnstile({
  siteKey,
  onSuccess,
  onExpire,
  onError,
  enabled = true,
  scriptSrc = TURNSTILE_SCRIPT_SRC,
}: UseTurnstileOptions): UseTurnstileReturn {
  const { isLoaded, isError } = useLoadScript(enabled ? scriptSrc : '')
  const widgetIdRef = useRef<string | null>(null)
  const callbacksRef = useRef({ onSuccess, onExpire, onError })
  const [container, setContainer] = useState<HTMLDivElement | null>(null)

  useEffect(() => {
    callbacksRef.current = { onSuccess, onExpire, onError }
  }, [onError, onExpire, onSuccess])

  const ref = useCallback((node: HTMLDivElement | null) => {
    setContainer(node)
  }, [])

  useEffect(() => {
    if (!isError) return
    callbacksRef.current.onError?.()
  }, [isError])

  useEffect(() => {
    if (!isLoaded || !container || !window.turnstile) return
    const widgetId = window.turnstile.render(container, {
      sitekey: siteKey,
      callback: (token) => callbacksRef.current.onSuccess(token),
      'expired-callback': () => callbacksRef.current.onExpire?.(),
      'error-callback': () => callbacksRef.current.onError?.(),
    })
    widgetIdRef.current = widgetId
    return () => {
      widgetIdRef.current = null
      window.turnstile?.remove(widgetId)
    }
  }, [container, isLoaded, siteKey])

  function reset() {
    const widgetId = widgetIdRef.current
    if (!widgetId || !window.turnstile) return
    window.turnstile.reset(widgetId)
  }

  return { ref, reset, isError }
}
