import sql from 'sql-template-strings'
import { describe, expect, it, vi } from 'vitest'

import { allowUnannotatedQuery } from '../prepared-statement-name.mts'

import type { QueryExecutor } from '../types.mts'
import { errorSummary } from './completion-audience.mts'
import {
  observeQueryCompletion,
  reportQueryCaptureFailure,
  runWithQueryCompletionDiagnostics,
  type QueryCompletion,
} from './query-completion.mts'

const executor = (() => Promise.resolve({})) as unknown as QueryExecutor
type Args = Parameters<QueryExecutor>

function observe(args: Args, promise: Promise<never>) {
  observeQueryCompletion(executor, args, promise as ReturnType<QueryExecutor>)
}

const ok = () => Promise.resolve({ rows: [] }) as never

describe('query completion diagnostics', () => {
  it('records settled queries for subscribers and the completed list', async () => {
    const events: QueryCompletion[] = []
    const { result, completedTransactions, completionDrain } =
      await runWithQueryCompletionDiagnostics(async (context) => {
        context.subscribe((event) => void events.push(event))
        observe(['/* a */ SELECT $1', [{ nested: 1 }]], ok())
        observe(
          [{ text: '/* b */ SELECT 1', values: [] } as never],
          Promise.reject(new Error('no')),
        )
        observe(['/* c */ SELECT 1'], ok())
        observe([{ text: '/* d */ SELECT 1' } as never], ok())
        await new Promise((resolve) => setImmediate(resolve))
        return 'done'
      })
    expect(result).toBe('done')
    expect(await completionDrain).toEqual([])
    expect(events.map((event) => event.status)).toEqual([
      'fulfilled',
      'rejected',
      'fulfilled',
      'fulfilled',
    ])
    expect(events[0]).toMatchObject({ text: '/* a */ SELECT $1', values: [{ nested: 1 }] })
    expect(completedTransactions).toEqual([
      { text: '/* a */ SELECT $1', values: [{ nested: 1 }], status: 'fulfilled' },
      {
        text: '/* b */ SELECT 1',
        values: [],
        status: 'rejected',
        error: { name: 'Error', message: 'no' },
      },
      { text: '/* c */ SELECT 1', values: [], status: 'fulfilled' },
      { text: '/* d */ SELECT 1', values: [], status: 'fulfilled' },
    ])
    expect(Object.isFrozen(completedTransactions[0]?.values[0])).toBe(true)
  })

  it('ignores queries outside a scope and after deactivation', async () => {
    observe(['/* x */ SELECT 1'], ok())
    expect(reportQueryCaptureFailure('x')).toBe(false)
    const { completedTransactions } = await runWithQueryCompletionDiagnostics(async (context) => {
      context.deactivate()
      context.subscribe(() => undefined)
      observe(['/* y */ SELECT 1'], ok())
      expect(reportQueryCaptureFailure('late')).toBe(false)
    })
    expect(completedTransactions).toEqual([])
  })

  it('reports listener failures, async listener rejections, and drains them', async () => {
    const reportError = vi.fn()
    const { completionDrain } = await runWithQueryCompletionDiagnostics(
      async (context) => {
        context.subscribe(() => {
          throw new Error('sync listener')
        })
        context.subscribe(() => Promise.reject(new Error('async listener')) as never)
        context.subscribe(() => Promise.resolve() as never)
        const gone = context.subscribe(() => undefined)
        gone()
        observe(['/* a */ SELECT 1'], ok())
        await new Promise((resolve) => setImmediate(resolve))
        expect(reportQueryCaptureFailure(new Error('capture'))).toBe(true)
      },
      { reportError },
    )
    const summaries = await completionDrain
    expect(summaries.map((summary) => summary.message)).toEqual([
      'sync listener',
      'async listener',
      'capture',
    ])
    expect(reportError).toHaveBeenCalledTimes(3)
    expect(reportError.mock.calls[0]?.[0].message).toBe('Query completion diagnostic failed')
  })

  it('survives a throwing error reporter and records its failure', async () => {
    const { completionDrain } = await runWithQueryCompletionDiagnostics(
      async (context) => {
        context.report('first')
      },
      {
        reportError: () => {
          throw new Error('reporter broke')
        },
      },
    )
    expect((await completionDrain).map((summary) => summary.message)).toEqual([
      'first',
      'reporter broke',
    ])
  })

  it('skips listeners removed mid-dispatch and caches the drain', async () => {
    const second = vi.fn()
    const { completionDrain } = await runWithQueryCompletionDiagnostics(async (context) => {
      const unsubscribeSecond = context.subscribe(second)
      context.subscribe(() => {
        unsubscribeSecond()
      })
      observe(['/* a */ SELECT 1'], ok())
      await new Promise((resolve) => setImmediate(resolve))
    })
    await completionDrain
    expect(second).toHaveBeenCalledOnce()
  })

  it('records the positional values of value-free allowed statements', async () => {
    const { completedTransactions } = await runWithQueryCompletionDiagnostics(async () => {
      observe([allowUnannotatedQuery('SELECT $1'), ['v']], ok())
      observe([sql`/* named */ SELECT ${'own'}`, ['ignored']], ok())
      await new Promise((resolve) => setImmediate(resolve))
    })
    expect(completedTransactions.map((entry) => entry.values)).toEqual([['v'], ['own']])
  })

  it('drains queries still in flight when the scope ends', async () => {
    let finish: () => void = () => {}
    const slow = new Promise<never>((resolve) => {
      finish = () => resolve(undefined as never)
    })
    const { completionDrain, completedTransactions } = await runWithQueryCompletionDiagnostics(
      async () => {
        observe(['/* slow */ SELECT 1'], slow)
      },
    )
    let drained = false
    void completionDrain.then(() => {
      drained = true
    })
    await new Promise((resolve) => setImmediate(resolve))
    expect(drained).toBe(false)
    finish()
    expect(await completionDrain).toEqual([])
    expect(completedTransactions).toEqual([])
  })

  it('stops dispatching once a listener deactivates the scope', async () => {
    const later = vi.fn()
    await runWithQueryCompletionDiagnostics(async (context) => {
      context.subscribe(() => {
        context.deactivate()
      })
      context.subscribe(later)
      observe(['/* a */ SELECT 1'], ok())
      await new Promise((resolve) => setImmediate(resolve))
    })
    expect(later).not.toHaveBeenCalled()
  })

  it('reports unreadable input and unserializable values without breaking the query', async () => {
    const circular: Record<string, unknown> = {}
    circular.self = circular
    const hostile = {
      get text(): string {
        throw new Error('text getter')
      },
    }
    const { completionDrain, completedTransactions } = await runWithQueryCompletionDiagnostics(
      async () => {
        observe([hostile as never], ok())
        observe(['/* a */ SELECT $1', [circular]], ok())
        await new Promise((resolve) => setImmediate(resolve))
      },
    )
    expect((await completionDrain).map((summary) => summary.message)).toEqual([
      'text getter',
      expect.stringContaining('circular'),
    ])
    expect(completedTransactions).toEqual([])
  })

  it('reports a promise whose then throws, and closes when the handler throws', async () => {
    const thenable = {
      // oxlint-disable-next-line unicorn/no-thenable -- the contract under test is a throwing thenable.
      then() {
        throw new Error('then broke')
      },
    }
    const { completionDrain } = await runWithQueryCompletionDiagnostics(async () => {
      observe(['/* a */ SELECT 1'], thenable as never)
    })
    expect((await completionDrain).map((summary) => summary.message)).toEqual(['then broke'])
    await expect(
      runWithQueryCompletionDiagnostics(async () => {
        throw new Error('handler failed')
      }),
    ).rejects.toThrow('handler failed')
  })
})

describe('errorSummary', () => {
  it('normalizes unreadable errors', () => {
    expect(errorSummary(new Error('x'))).toEqual({ name: 'Error', message: 'x' })
    expect(errorSummary('text')).toEqual({ name: 'Error', message: 'text' })
    const odd = Object.assign(new Error('x'), { name: 5 })
    expect(errorSummary(odd).name).toBe('Error')
    const noMessage = new Error('x')
    Object.defineProperty(noMessage, 'message', { value: 5 })
    expect(errorSummary(noMessage).message).toBe('Unreadable diagnostic error')
    const hostile = {
      toString() {
        throw new Error('no string')
      },
    }
    expect(errorSummary(hostile)).toEqual({
      name: 'Error',
      message: 'Unreadable diagnostic error',
    })
  })
})
