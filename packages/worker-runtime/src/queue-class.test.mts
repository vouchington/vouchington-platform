import { describe, expect, it } from 'vitest'

import { createQueueClassResolver, WorkerQueueClassError } from './queue-class.mts'

const policy = { all: ['a', 'b', 'c'], cpu: ['a'], io: ['b', 'c'] } as const
const resolve = createQueueClassResolver(policy)
const known = ['a', 'b', 'c']

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn()
  } catch (error) {
    return error instanceof WorkerQueueClassError ? error.code : 'OTHER'
  }
  return undefined
}

describe('createQueueClassResolver', () => {
  it('expands a class to an explicit include list', () => {
    expect(resolve({ WORKER_QUEUE_CLASS: 'io' }, ['all', 'io'], known)).toBe('b,c')
    expect(resolve({ WORKER_QUEUE_CLASS: ' all ' }, ['all'], known)).toBe('a,b,c')
  })

  it('returns QUEUES untouched when no class is set, treating blanks as unset', () => {
    expect(resolve({ QUEUES: 'a,b' }, ['all'], known)).toBe('a,b')
    expect(resolve({ QUEUES: '-a' }, ['all'], known)).toBe('-a')
    expect(resolve({}, ['all'], known)).toBeUndefined()
    expect(resolve({ WORKER_QUEUE_CLASS: '  ', QUEUES: undefined }, ['all'], known)).toBeUndefined()
    expect(resolve({ WORKER_QUEUE_CLASS: '', QUEUES: 'a' }, ['all'], known)).toBe('a')
  })

  it('treats a blank QUEUES as unset when a class is set', () => {
    expect(resolve({ WORKER_QUEUE_CLASS: 'cpu', QUEUES: '  ' }, ['cpu'], known)).toBe('a')
  })

  it('rejects setting both selectors', () => {
    expect(codeOf(() => resolve({ WORKER_QUEUE_CLASS: 'cpu', QUEUES: 'a' }, ['cpu'], known))).toBe(
      'CONFLICTING_QUEUE_SELECTORS',
    )
  })

  it('rejects classes that are unaccepted or not in the policy', () => {
    expect(codeOf(() => resolve({ WORKER_QUEUE_CLASS: 'io' }, ['cpu'], known))).toBe(
      'UNSUPPORTED_QUEUE_CLASS',
    )
    expect(codeOf(() => resolve({ WORKER_QUEUE_CLASS: 'toString' }, ['all'], known))).toBe(
      'UNSUPPORTED_QUEUE_CLASS',
    )
    expect(() => resolve({ WORKER_QUEUE_CLASS: 'gpu' }, ['all', 'cpu'], known)).toThrow(
      'must be one of all, cpu for this worker, got "gpu"',
    )
  })

  it('rejects unknown include and exclude names', () => {
    expect(codeOf(() => resolve({ QUEUES: 'a,zzz' }, ['all'], known))).toBe('UNKNOWN_QUEUE_NAMES')
    expect(() => resolve({ QUEUES: '-yyy, -zzz,-yyy' }, ['all'], known)).toThrow(
      'does not run: yyy, zzz',
    )
  })

  it('names the error and leaves empty entries for the selection parser', () => {
    const error = new WorkerQueueClassError('UNKNOWN_QUEUE_NAMES', 'x')
    expect(error.name).toBe('WorkerQueueClassError')
    expect(resolve({ QUEUES: 'a,,b' }, ['all'], known)).toBe('a,,b')
  })
})
