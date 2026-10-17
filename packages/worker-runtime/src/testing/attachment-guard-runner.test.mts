import { afterEach, describe, expect, it, TestRunner } from 'vitest'

import { toTestError } from './attachment-guard-runner.mts'
import {
  createWorkerAttachmentGuardRunner,
  createWorkerAttachmentLeakError,
  Worker,
} from './index.mts'

let counter = 0
const workers: Worker[] = []
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.close()))
})

class FakeRunner {
  imported: Array<[string, string]> = []
  failImport: unknown
  afterSuite = 0
  async importFile(filepath: string, source: string): Promise<void> {
    this.imported.push([filepath, source])
    if (this.failImport !== undefined) throw this.failImport
  }
  async onAfterRunSuite(): Promise<void> {
    this.afterSuite += 1
  }
}

function attach(): Worker {
  counter += 1
  const worker = new Worker(`guard-${counter}`, () => undefined)
  workers.push(worker)
  return worker
}

type Suite = { filepath?: unknown; result?: { errors?: unknown[]; state?: string } }
function make() {
  const Guarded = createWorkerAttachmentGuardRunner(FakeRunner as never) as unknown as new () => {
    imported: Array<[string, string]>
    failImport: unknown
    afterSuite: number
    importFile(filepath: string, source: string): Promise<void>
    onAfterRunSuite(suite: Suite): Promise<void>
  }
  return new Guarded()
}

function firstError(suite: Suite): Error {
  return suite.result!.errors![0] as Error
}

describe('createWorkerAttachmentLeakError', () => {
  it('lists leaked queue names with remediation', () => {
    const message = createWorkerAttachmentLeakError(['a', 'b']).message
    expect(message).toContain('- a\n- b')
    expect(message).toContain('await worker.close()')
  })
})

describe('createWorkerAttachmentGuardRunner', () => {
  it('extends Vitest TestRunner by default', () => {
    expect(Object.getPrototypeOf(createWorkerAttachmentGuardRunner())).toBe(TestRunner)
  })

  it('passes non-collect imports straight through', async () => {
    const runner = make()
    await runner.importFile('/f.test.ts', 'setup')
    expect(runner.imported).toEqual([['/f.test.ts', 'setup']])
  })

  it('passes a clean file', async () => {
    const runner = make()
    await runner.importFile('/ok.test.ts', 'collect')
    const suite: Suite = { filepath: '/ok.test.ts', result: { state: 'pass' } }
    await runner.onAfterRunSuite(suite)
    expect(suite.result?.state).toBe('pass')
    expect(runner.afterSuite).toBe(1)
  })

  it('rethrows import failures that did not leak workers', async () => {
    const runner = make()
    const failure = new Error('syntax')
    runner.failImport = failure
    await expect(runner.importFile('/bad.test.ts', 'collect')).rejects.toBe(failure)
  })

  it('appends leak details to import failures that leaked workers', async () => {
    const runner = make()
    runner.failImport = new Error('syntax')
    const original = runner.importFile.bind(runner)
    runner.importFile = async (filepath, source) => {
      const pending = original(filepath, source)
      attach()
      return pending
    }
    const error = await runner.importFile('/leak.test.ts', 'collect').catch((err: unknown) => err)
    expect((error as Error).message).toContain('syntax')
    expect((error as Error).message).toContain('worker-attachment-leak')
    expect((error as Error).cause).toBeInstanceOf(Error)
  })

  it('stringifies non-Error import failures that leaked workers', async () => {
    const runner = make()
    runner.failImport = 'plain'
    const original = runner.importFile.bind(runner)
    runner.importFile = async (filepath, source) => {
      const pending = original(filepath, source)
      attach()
      return pending
    }
    const error = await runner.importFile('/leak2.test.ts', 'collect').catch((err: unknown) => err)
    expect((error as Error).message.startsWith('plain\n\n')).toBe(true)
  })

  it('fails the suite when a worker stays attached after the file', async () => {
    const runner = make()
    await runner.importFile('/after.test.ts', 'collect')
    attach()
    const suite: Suite = { filepath: '/after.test.ts', result: { state: 'pass' } }
    await runner.onAfterRunSuite(suite)
    expect(suite.result?.state).toBe('fail')
    expect(suite.result?.errors).toHaveLength(1)
    expect(firstError(suite).message).toContain('worker-attachment-leak')
    expect(firstError(suite).name).toBe('Error')
  })

  it('converts thrown values to Vitest test errors', () => {
    const stackless = Object.defineProperty(new Error('leak'), 'stack', { value: undefined })
    expect(toTestError(stackless)).toEqual({ message: 'leak', name: 'Error' })
    expect(toTestError(new Error('with stack')).stack).toContain('with stack')
    expect(toTestError(42)).toEqual({ message: '42' })
  })

  it('reuses an existing errors array on the suite result', async () => {
    const runner = make()
    await runner.importFile('/reuse.test.ts', 'collect')
    attach()
    const suite: Suite = { filepath: '/reuse.test.ts', result: { errors: ['x'], state: 'pass' } }
    await runner.onAfterRunSuite(suite)
    expect(suite.result?.errors).toHaveLength(2)
  })

  it('reports a missing baseline on the suite result', async () => {
    const runner = make()
    const suite: Suite = { filepath: '/never-imported.test.ts', result: { state: 'pass' } }
    await runner.onAfterRunSuite(suite)
    expect(suite.result?.state).toBe('fail')
    expect(firstError(suite).message).toContain('baseline was not initialized')
  })

  it('throws when there is no result to annotate', async () => {
    const runner = make()
    await expect(runner.onAfterRunSuite({ filepath: '/none.test.ts' })).rejects.toThrow(
      'baseline was not initialized',
    )
  })

  it('ignores suites without a file path', async () => {
    const runner = make()
    await runner.onAfterRunSuite({})
    await runner.onAfterRunSuite({ filepath: 1 })
    expect(runner.afterSuite).toBe(2)
  })
})
