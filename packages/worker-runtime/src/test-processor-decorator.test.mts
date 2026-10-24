import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  getTestWorkerProcessorDecorator,
  setTestWorkerProcessorDecorator,
} from './test-processor-decorator.mts'

describe('test worker processor decorator slot', () => {
  afterEach(() => setTestWorkerProcessorDecorator(undefined))

  it('is empty by default and can be set and cleared', () => {
    expect(getTestWorkerProcessorDecorator()).toBeUndefined()
    const decorator = (processor: unknown) => processor
    setTestWorkerProcessorDecorator(decorator)
    expect(getTestWorkerProcessorDecorator()).toBe(decorator)
    setTestWorkerProcessorDecorator(undefined)
    expect(getTestWorkerProcessorDecorator()).toBeUndefined()
  })

  it('is stored under a package-scoped global symbol', () => {
    const decorator = (processor: unknown) => processor
    setTestWorkerProcessorDecorator(decorator)

    const key = Symbol.for('@vouchington/worker-runtime.testWorkerProcessorDecorator')
    expect((globalThis as Record<symbol, unknown>)[key]).toBe(decorator)
  })

  it('survives vi.resetModules()', async () => {
    const decorator = (processor: unknown) => processor
    setTestWorkerProcessorDecorator(decorator)
    vi.resetModules()

    const fresh = await import('./test-processor-decorator.mts')

    expect(fresh.getTestWorkerProcessorDecorator()).toBe(decorator)
  })
})
