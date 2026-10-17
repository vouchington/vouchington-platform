import { afterEach, describe, expect, it, vi } from 'vitest'

import type { QueryExecutor } from '../types.mts'
import {
  createSharedDbScopeObserver,
  sharedDbCursorScope,
  sharedDbIdsScope,
} from './scope-observer.mts'

const observer = createSharedDbScopeObserver({
  key: 'test.shared-db-scope-observer',
  tables: { listQueue: 'queue_items', sweepRows: 'rows' },
})

afterEach(() => observer.install(undefined))

describe('shared DB scope observer', () => {
  it('is a no-op until installed', () => {
    expect(() => observer.observe('listQueue', { kind: 'global' })).not.toThrow()
  })

  it('reports operation, mapped table and optional details', () => {
    const seen = vi.fn()
    observer.install(seen)
    const transaction = (() => {}) as unknown as QueryExecutor
    const keysetRead = {
      phase: 'completed',
      identity: Symbol('read'),
      rowCount: 0,
      first: undefined,
    } as const
    observer.observe('listQueue', sharedDbIdsScope(['a']))
    observer.observe('sweepRows', sharedDbCursorScope('c'), keysetRead, transaction)
    expect(seen.mock.calls).toEqual([
      [{ operation: 'listQueue', table: 'queue_items', scope: { kind: 'ids', ids: ['a'] } }],
      [
        {
          operation: 'sweepRows',
          table: 'rows',
          scope: { kind: 'cursor', id: 'c' },
          keysetRead,
          transaction,
        },
      ],
    ])
  })

  it('shares the installed observer across instances with the same key', () => {
    const seen = vi.fn()
    createSharedDbScopeObserver({
      key: 'test.shared-db-scope-observer',
      tables: { x: 'y' },
    }).install(seen)
    observer.observe('listQueue', { kind: 'global' })
    expect(seen).toHaveBeenCalledOnce()
  })

  it('builds scopes', () => {
    expect(sharedDbIdsScope()).toEqual({ kind: 'global' })
    expect(sharedDbIdsScope(['a'])).toEqual({ kind: 'ids', ids: ['a'] })
    expect(sharedDbCursorScope(null)).toEqual({ kind: 'global' })
    expect(sharedDbCursorScope('')).toEqual({ kind: 'global' })
    expect(sharedDbCursorScope('c')).toEqual({ kind: 'cursor', id: 'c' })
  })
})
