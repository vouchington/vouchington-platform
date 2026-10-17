import { type TestError, TestRunner } from 'vitest'

import { captureAttachedTestWorkers, getUnexpectedAttachedTestWorkerQueueNames } from './queue.mts'

type RunnerConstructor = new (...args: any[]) => TestRunner

export function createWorkerAttachmentLeakError(queueNames: string[]): Error {
  return new Error(
    [
      '[vitest-glide-mq-worker-attachment-leak] TestWorker instances remained attached after this test file:',
      ...queueNames.map((queueName) => `- ${queueName}`),
      'Close every worker created by the file in its afterAll cleanup (await worker.close()).',
      'This guard intentionally does not close workers, so the leak remains visible at its source.',
    ].join('\n'),
  )
}

export function toTestError(err: unknown): TestError {
  return err instanceof Error
    ? { message: err.message, name: err.name, ...(err.stack && { stack: err.stack }) }
    : { message: String(err) }
}

/**
 * Build a Vitest runner that fails a file when it leaves TestWorkers attached. Pass an application
 * runner as `BaseRunner` to compose guards; export the result as the default of a `test.runner`
 * module.
 */
export function createWorkerAttachmentGuardRunner<Base extends RunnerConstructor>(
  BaseRunner: Base = TestRunner as unknown as Base,
): Base {
  class GlideMqWorkerAttachmentGuardRunner extends BaseRunner {
    #baselines = new Map<string, ReadonlySet<string>>()

    override async importFile(
      filepath: string,
      source: Parameters<TestRunner['importFile']>[1],
    ): Promise<void> {
      if (source !== 'collect') {
        await super.importFile(filepath, source)
        return
      }
      const baseline = await captureAttachedTestWorkers()
      this.#baselines.set(filepath, baseline)
      try {
        await super.importFile(filepath, source)
      } catch (err) {
        const queueNames = await getUnexpectedAttachedTestWorkerQueueNames(baseline)
        if (queueNames.length === 0) throw err
        const leakError = createWorkerAttachmentLeakError(queueNames)
        throw new Error(
          `${err instanceof Error ? err.message : String(err)}\n\n${leakError.message}`,
          { cause: err },
        )
      }
    }

    override async onAfterRunSuite(suite: Parameters<TestRunner['onAfterRunSuite']>[0]) {
      await super.onAfterRunSuite(suite)
      if (!('filepath' in suite) || typeof suite.filepath !== 'string') return
      try {
        const baseline = this.#baselines.get(suite.filepath)
        if (!baseline) throw new Error('Worker attachment guard baseline was not initialized')
        const queueNames = await getUnexpectedAttachedTestWorkerQueueNames(baseline)
        if (queueNames.length === 0) return
        throw createWorkerAttachmentLeakError(queueNames)
      } catch (err) {
        const result = suite.result
        if (!result) throw err
        if (!result.errors) result.errors = []
        result.errors.push(toTestError(err))
        result.state = 'fail'
      }
    }
  }
  return GlideMqWorkerAttachmentGuardRunner
}
