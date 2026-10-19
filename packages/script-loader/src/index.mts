import { useCallback, useSyncExternalStore } from 'react'

type ScriptStatus = 'idle' | 'loading' | 'ready' | 'error'

type ScriptRecord = { status: 'loading' | 'ready' } | { status: 'error'; errorAt: number }

export interface UseLoadScriptOptions {
  nonce?: string
  integrity?: string
  crossOrigin?: HTMLScriptElement['crossOrigin']
  /** Milliseconds before a failed src may be retried. Default 30_000. */
  errorRetryMs?: number
}

export interface UseLoadScriptResult {
  isLoaded: boolean
  isError: boolean
}

interface ResolvedScriptOptions {
  nonce: string | undefined
  integrity: string | undefined
  crossOrigin: HTMLScriptElement['crossOrigin'] | undefined
  errorRetryMs: number
}

const DEFAULT_ERROR_RETRY_MS = 30_000
const records = new Map<string, ScriptRecord>()
const listeners = new Map<string, Set<() => void>>()

export function resetScriptLoaderForTests(): void {
  records.clear()
  listeners.clear()
}

function notify(src: string, status: 'ready' | 'error'): void {
  records.set(src, status === 'error' ? { status, errorAt: Date.now() } : { status })
  const callbacks = listeners.get(src)
  if (!callbacks) return
  for (const callback of callbacks) callback()
}

function getScriptStatus(src: string): ScriptStatus {
  if (!src) return 'idle'
  return records.get(src)?.status ?? 'idle'
}

function ensureScript(src: string, options: ResolvedScriptOptions): void {
  const current = records.get(src)
  if (current?.status === 'error' && Date.now() - current.errorAt > options.errorRetryMs) {
    records.delete(src)
  }

  if (records.has(src)) return
  records.set(src, { status: 'loading' })
  const callbacks = listeners.get(src)
  if (callbacks) {
    for (const callback of callbacks) callback()
  }
  const script = document.createElement('script')
  script.src = src
  script.async = true
  if (options.nonce) script.nonce = options.nonce
  if (options.integrity) script.integrity = options.integrity
  if (options.crossOrigin !== undefined) script.crossOrigin = options.crossOrigin
  script.onload = () => notify(src, 'ready')
  script.onerror = () => notify(src, 'error')
  document.head.append(script)
}

function subscribeToScript(
  src: string,
  options: ResolvedScriptOptions,
  onStoreChange: () => void,
): () => void {
  if (!src) return () => undefined
  ensureScript(src, options)
  const callbacks = listeners.get(src) ?? new Set()
  listeners.set(src, callbacks)
  callbacks.add(onStoreChange)
  return () => {
    callbacks.delete(onStoreChange)
    if (callbacks.size === 0) listeners.delete(src)
  }
}

/**
 * Loads one script tag per `src`, shared by every caller.
 * An empty `src` does not load.
 */
export function useLoadScript(
  src: string,
  options: UseLoadScriptOptions = {},
): UseLoadScriptResult {
  const nonce = options.nonce
  const integrity = options.integrity
  const crossOrigin = options.crossOrigin
  const errorRetryMs = options.errorRetryMs ?? DEFAULT_ERROR_RETRY_MS
  const subscribe = useCallback(
    (onStoreChange: () => void) =>
      subscribeToScript(src, { nonce, integrity, crossOrigin, errorRetryMs }, onStoreChange),
    [crossOrigin, errorRetryMs, integrity, nonce, src],
  )
  const status = useSyncExternalStore(
    subscribe,
    () => getScriptStatus(src),
    () => 'idle',
  )
  return { isLoaded: status === 'ready', isError: status === 'error' }
}
