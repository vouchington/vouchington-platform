import { describe, expect, it, vi } from 'vitest'
import { isModelProviderError, ModelProviderError } from './errors.mts'

type ErrorsModule = typeof import('./errors.mts')

async function loadCopy(): Promise<ErrorsModule> {
  vi.resetModules()
  return import('./errors.mts')
}

const options = { retryClass: 'permanent' } as const

describe('ModelProviderError brand', () => {
  it('recognizes errors from a separately loaded module instance both ways', async () => {
    const copy = await loadCopy()
    expect(copy.ModelProviderError).not.toBe(ModelProviderError)
    const mine = new ModelProviderError('invalid-response', 'a', options)
    const theirs = new copy.ModelProviderError('invalid-response', 'b', options)
    expect(mine).toBeInstanceOf(copy.ModelProviderError)
    expect(theirs).toBeInstanceOf(ModelProviderError)
    expect(isModelProviderError(theirs)).toBe(true)
    expect(copy.isModelProviderError(mine)).toBe(true)
  })

  it('recognizes the same error through the guard and instanceof', () => {
    const error = new ModelProviderError('refusal', 'x', options)
    expect(isModelProviderError(error)).toBe(true)
    expect(error instanceof ModelProviderError).toBe(true)
  })

  it('recognizes subclasses', () => {
    class Sub extends ModelProviderError {}
    expect(isModelProviderError(new Sub('refusal', 'x', options))).toBe(true)
  })

  it.each([null, undefined, 'x', 1, {}, new Error('plain'), { [Symbol.for('other')]: true }])(
    'rejects %#',
    (value) => {
      expect(isModelProviderError(value)).toBe(false)
      expect(value instanceof ModelProviderError).toBe(false)
    },
  )
})
