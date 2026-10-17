import { AsyncLocalStorage } from 'node:async_hooks'

import type { QueryExecutor } from '../types.mts'

export type QueryCompletion = {
  text: string
  values: readonly unknown[]
  executor: QueryExecutor
  promise: ReturnType<QueryExecutor>
} & ({ status: 'fulfilled' } | { status: 'rejected'; reason: unknown })

export type ErrorSummary = Readonly<{ name: string; message: string }>

type TransactionSnapshot = Readonly<{
  text: string
  values: readonly unknown[]
  status: 'fulfilled' | 'rejected'
  error?: ErrorSummary
}>

export type CompletionAudience = {
  active: boolean
  pending: Set<Promise<unknown>>
  listeners: Set<(event: QueryCompletion) => undefined>
  completed: TransactionSnapshot[]
  report: (reason: unknown) => undefined
}

export const completionAudiences = new AsyncLocalStorage<CompletionAudience>()

export function errorSummary(reason: unknown): ErrorSummary {
  try {
    const summary: { name: unknown; message: unknown } =
      reason instanceof Error
        ? { name: reason.name, message: reason.message }
        : { name: 'Error', message: String(reason) }
    return Object.freeze({
      name: typeof summary.name === 'string' ? summary.name : 'Error',
      message:
        typeof summary.message === 'string' ? summary.message : 'Unreadable diagnostic error',
    })
  } catch {
    return Object.freeze({ name: 'Error', message: 'Unreadable diagnostic error' })
  }
}

export function createQueryCompletionAudience(reportError?: (error: Error) => void) {
  const errors: ErrorSummary[] = []
  const pending = new Set<Promise<unknown>>()
  const report = (reason: unknown): undefined => {
    errors.push(errorSummary(reason))
    try {
      reportError?.(new Error('Query completion diagnostic failed', { cause: reason }))
    } catch (err) {
      errors.push(errorSummary(err))
    }
    return undefined
  }
  const audience: CompletionAudience = {
    active: true,
    pending,
    listeners: new Set(),
    completed: [],
    report,
  }
  let closing: Promise<readonly ErrorSummary[]> | undefined
  return {
    scope: audience,
    completed: audience.completed,
    report,
    subscribe(listener: (event: QueryCompletion) => undefined) {
      if (audience.active) audience.listeners.add(listener)
      return () => {
        audience.listeners.delete(listener)
      }
    },
    deactivate: () => {
      audience.active = false
      audience.listeners.clear()
    },
    close: (): Promise<readonly ErrorSummary[]> => {
      audience.active = false
      audience.listeners.clear()
      closing ??= (async () => {
        // oxlint-disable-next-line no-await-in-loop -- settlement may add reporting work; drain that owned batch next.
        while (pending.size) await Promise.allSettled(pending)
        return Object.freeze([...errors])
      })()
      return closing
    },
  }
}
