import { describe, expect, it, vi } from 'vitest'
import * as response from '../openai/response.mts'
import * as decisions from '../structured-decisions/errors.mts'

type Branded = {
  name: string
  load: () => Promise<{
    Class: abstract new (...args: never[]) => Error
    is: (v: unknown) => boolean
  }>
  make: (Class: never) => Error
}

const notCompleted = { status: 'failed', output: [] }

const cases: Branded[] = [
  {
    name: 'StructuredDecisionError',
    load: async () => {
      const m = await import('../structured-decisions/errors.mts')
      return { Class: m.StructuredDecisionError, is: m.isStructuredDecisionError }
    },
    make: (Class: typeof decisions.StructuredDecisionError) => new Class('invalid-response', 'x'),
  },
  {
    name: 'OpenAIResponseNotCompletedError',
    load: async () => {
      const m = await import('../openai/response.mts')
      return { Class: m.OpenAIResponseNotCompletedError, is: m.isOpenAIResponseNotCompletedError }
    },
    make: (Class: typeof response.OpenAIResponseNotCompletedError) => new Class('x', notCompleted),
  },
  {
    name: 'OpenAIResponseStreamIterationError',
    load: async () => {
      const m = await import('../openai/response.mts')
      return {
        Class: m.OpenAIResponseStreamIterationError,
        is: m.isOpenAIResponseStreamIterationError,
      }
    },
    make: (Class: typeof response.OpenAIResponseStreamIterationError) =>
      new Class(false, { cause: null }),
  },
] as never

describe.each(cases)('$name brand', ({ load, make }) => {
  it('is recognized across separately loaded module copies, both ways', async () => {
    const mine = await load()
    vi.resetModules()
    const theirs = await load()
    expect(theirs.Class).not.toBe(mine.Class)
    const a = make(mine.Class as never)
    const b = make(theirs.Class as never)
    expect(a).toBeInstanceOf(theirs.Class)
    expect(b).toBeInstanceOf(mine.Class)
    expect(mine.is(b)).toBe(true)
    expect(theirs.is(a)).toBe(true)
  })

  it('keeps subclass instanceof checks prototype-based', async () => {
    const { Class, is } = await load()
    const Base = Class as unknown as new (...args: unknown[]) => Error
    class Sub extends Base {}
    const base = make(Class as never)
    expect(base instanceof Sub).toBe(false)
    expect(is(Object.setPrototypeOf(base, Sub.prototype))).toBe(true)
  })

  it.each([null, undefined, 'x', 1, {}, new Error('plain'), { [Symbol.for('other')]: true }])(
    'rejects %#',
    async (value) => {
      const { Class, is } = await load()
      expect(is(value)).toBe(false)
      expect(value instanceof Class).toBe(false)
    },
  )
})
